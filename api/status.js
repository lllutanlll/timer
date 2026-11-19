// Notion Timer /api/status 修正版 v3.2（累積表示＋秒の精密化）

const PROP_STATE = "現在作業中";
const PROP_TASK = "作業名";
const REC_START = "作業開始時刻";
const REC_END = "作業終了時刻";
const REC_TASK = "作業名";
const REC_PRECISE = "タイマー計測";
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

// 名前比較用: 前後の空白を取り除く（記録DB側の名前に末尾空白があるため）
function normName(s) {
  return (s || "").trim();
}

function dateMs(prop) {
  if (prop && prop.type === "date" && prop.date && prop.date.start) {
    const t = Date.parse(prop.date.start);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// 「タイマー計測」テキスト（例: s=1730000000000;e=1730003600000）を読む
function parsePrecise(page) {
  const prop = page.properties && page.properties[REC_PRECISE];
  const result = { s: null, e: null };
  if (!prop || prop.type !== "rich_text") return result;
  const text = (prop.rich_text || []).map(item => item.plain_text || "").join("");
  const ms = text.match(/s=(\d+)/);
  const me = text.match(/e=(\d+)/);
  if (ms) result.s = parseInt(ms[1], 10);
  if (me) result.e = parseInt(me[1], 10);
  return result;
}

async function writePrecise(token, pageId, precise) {
  let text = "";
  if (precise.s !== null) text += "s=" + precise.s;
  if (precise.e !== null) text += (text ? ";" : "") + "e=" + precise.e;
  try {
    const response = await fetch("https://api.notion.com/v1/pages/" + pageId, {
      method: "PATCH",
      headers: notionHeaders(token),
      body: JSON.stringify({
        properties: {
          [REC_PRECISE]: { rich_text: [{ text: { content: text } }] }
        }
      })
    });
    return response.ok;
  } catch (e) {
    return false;
  }
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
    const now = Date.now();

    let totalMs = 0;
    let lastTask = "";
    let openRecord = null;
    const openCandidates = [];

    for (const r of records) {
      const task = titleText(r.properties[REC_TASK]);
      if (normName(task) === RESET_TASK_NAME) continue;

      const s = dateMs(r.properties[REC_START]);
      const e = dateMs(r.properties[REC_END]);
      if (s === null) continue;

      lastTask = task;
      const precise = parsePrecise(r);

      if (runningRow && (e === null || e <= s) && precise.e === null) {
        // 作業中の区間（開始＝終了で入っている未終了レコード）の候補。
        // 名前が一致するものを優先し、決め方はループ後に行う
        openCandidates.push({
          page: r, precise: precise, dateStart: s,
          taskN: normName(task), created: Date.parse(r.created_time) || 0
        });
      } else {
        // 終了済みの区間（開始と終了が同じ分の短い区間も含む）
        if (precise.s !== null && precise.e !== null) {
          totalMs += Math.max(0, precise.e - precise.s);
        } else if (precise.s !== null && now - Date.parse(r.last_edited_time) < 120000) {
          // 開いている間に始まって、さっき終わった区間:
          // 終わりの精密時刻を記録して、秒まで数える
          const ok = await writePrecise(token, r.id, { s: precise.s, e: now });
          totalMs += ok ? Math.max(0, now - precise.s) : Math.max(0, (e || s) - s);
        } else {
          totalMs += Math.max(0, (e || s) - s);
        }
      }
    }

    if (openCandidates.length > 0) {
      const runningN = normName(runningTask);
      const matched = openCandidates.filter(c => c.taskN === runningN);
      const pool = matched.length > 0 ? matched : openCandidates;
      openRecord = pool.reduce((a, b) => (b.created >= a.created ? b : a));
    }

    if (openRecord) {
      if (openRecord.precise.s !== null) {
        totalMs += Math.max(0, now - openRecord.precise.s);
      } else {
        // 初めて見る区間: 精密な開始時刻を記録する（誤差は同期間隔＝数秒程度）
        const ok = await writePrecise(token, openRecord.page.id, { s: now, e: null });
        if (!ok) {
          // 書き込めない場合は従来通り分単位で数える
          totalMs += Math.max(0, now - openRecord.dateStart);
        }
      }
    } else if (runningRow) {
      // 未終了レコードが見つからない場合の代用:
      // 総合作業管理DBの行の最終更新時刻から数える
      totalMs += Math.max(0, now - Date.parse(runningRow.last_edited_time));
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
