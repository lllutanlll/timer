// Notion Timer /api/status 修正版 v3

const PROP_STATE = "現在作業中";
const PROP_TASK = "作業名";
const REC_START = "作業開始時刻";
const REC_END = "作業終了時刻";
const REC_TASK = "作業名";
const RESET_TASK_NAME = "タイマーリセット";

function notionHeaders(token) {
  return {
    "Authorization": "Bearer " + token,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

async function queryDb(token, databaseId, body) {
  const response = await fetch(
    "https://api.notion.com/v1/databases/" + databaseId + "/query",
    { method: "POST", headers: notionHeaders(token), body: JSON.stringify(body) }
  );
  return response.json();
}

async function queryAllSince(token, databaseId, sinceMs) {
  // リセット以降のレコードを全件取る（最大5ページ＝500件まで）
  const filter = sinceMs
    ? { property: REC_START, date: { on_or_after: new Date(sinceMs).toISOString() } }
    : undefined;

  let results = [];
  let cursor = undefined;
  for (let i = 0; i < 5; i++) {
    const body = {
      page_size: 100,
      sorts: [{ property: REC_START, direction: "ascending" }]
    };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const data = await queryDb(token, databaseId, body);
    results = results.concat(data.results || []);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return results;
}

function titleText(prop) {
  if (!prop) return "";
  const list = prop.type === "title" ? prop.title : prop.type === "rich_text" ? prop.rich_text : [];
  return (list || []).map(item => item.plain_text || "").join("");
}

function dateMs(prop) {
  if (prop && prop.type === "date" && prop.date && prop.date.start) {
    const t = Date.parse(prop.date.start);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

module.exports = async function handler(req, res) {

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(403).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const databaseId = process.env.DATABASE_ID;
  const recordDatabaseId = process.env.RECORD_DATABASE_ID;
  const token = process.env.NOTION_TOKEN;

  try {

    // ---- リセット（画面の ↺ から POST） ----
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      if (!body || body.action !== "reset") {
        return res.status(400).json({ error: "bad request" });
      }
      if (!recordDatabaseId) {
        return res.status(500).json({ error: "RECORD_DATABASE_ID is not set" });
      }

      const nowIso = new Date().toISOString();
      const createRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: notionHeaders(token),
        body: JSON.stringify({
          parent: { database_id: recordDatabaseId },
          properties: {
            [REC_TASK]: { title: [{ text: { content: RESET_TASK_NAME } }] },
            [REC_START]: { date: { start: nowIso } },
            [REC_END]: { date: { start: nowIso } }
          }
        })
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        // インテグレーションに挿入権限がない場合など
        return res.status(502).json({ error: "reset record failed", detail: created });
      }
      return res.status(200).json({ ok: true, resetAt: nowIso });
    }

    // ---- 状態取得（GET） ----

    // 作業中の作業名（総合作業管理DB）
    const data = await queryDb(token, databaseId, {
      filter: { property: PROP_STATE, select: { equals: "作業中" } }
    });
    const runningRow = data.results && data.results[0];
    const runningTask = runningRow ? titleText(runningRow.properties[PROP_TASK]) : "";

    if (!recordDatabaseId) {
      // 作業記録DBが未設定なら、従来通り作業中かどうかだけ返す
      return res.status(200).json({
        running: !!runningRow, task: runningTask, elapsedSeconds: 0, noRecordDb: true
      });
    }

    // 最新のリセット記録を探す
    const resetData = await queryDb(token, recordDatabaseId, {
      filter: { property: REC_TASK, title: { equals: RESET_TASK_NAME } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 1
    });
    const resetRow = resetData.results && resetData.results[0];
    const resetMs = resetRow ? dateMs(resetRow.properties[REC_START]) : null;

    // リセット以降のレコードを合計する
    const records = await queryAllSince(token, recordDatabaseId, resetMs);

    let totalMs = 0;
    let lastTask = "";
    let openStartMs = null;

    for (const r of records) {
      const task = titleText(r.properties[REC_TASK]);
      if (task === RESET_TASK_NAME) continue;

      const s = dateMs(r.properties[REC_START]);
      const e = dateMs(r.properties[REC_END]);
      if (s === null) continue;

      lastTask = task;

      if (e !== null && e > s) {
        totalMs += e - s; // 終了済みの区間
      } else if (runningRow && task === runningTask) {
        // 作業中の区間（開始＝終了で入っている未終了レコード）
        openStartMs = s;
      }
    }

    if (openStartMs !== null) {
      totalMs += Math.max(0, Date.now() - openStartMs);
    } else if (runningRow) {
      // 未終了レコードが見つからない場合の代用:
      // 総合作業管理DBの行の最終更新時刻から数える
      totalMs += Math.max(0, Date.now() - Date.parse(runningRow.last_edited_time));
    }

    return res.status(200).json({
      running: !!runningRow,
      stopped: !runningRow && totalMs > 0,
      task: runningRow ? runningTask : lastTask,
      elapsedSeconds: Math.floor(totalMs / 1000),
      resetAt: resetMs ? new Date(resetMs).toISOString() : null
    });

  } catch (e) {

    return res.status(200).json({
      error: String(e)
    });

  }

};
