module.exports = async function handler(req, res) {

  if (
    req.headers["x-api-key"] !== process.env.API_KEY
  ) {
    return res.status(403).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    const databaseId = process.env.DATABASE_ID;
    const token = process.env.NOTION_TOKEN;

    const response = await fetch(
      "https://api.notion.com/v1/databases/" + databaseId + "/query",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: {
            property: "現在作業中",
            select: {
              equals: "作業中"
            }
          }
        })
      }
    );

    const data = await response.json();

    let taskName = "";

    if (
      data.results &&
      data.results[0] &&
      data.results[0].properties["作業名"]
    ) {

      const prop = data.results[0].properties["作業名"];

      if (prop.type === "rich_text") {

        taskName = prop.rich_text
          .map(item => item.plain_text)
          .join("");

      }

      if (prop.type === "title") {

        taskName = prop.title
          .map(item => item.plain_text)
          .join("");

      }

    }

    return res.status(200).json({
      running: data.results && data.results.length > 0,
      task: taskName
    });

  } catch (e) {

    return res.status(200).json({
      error: String(e)
    });

  }

}
