export default async function handler(req, res) {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${process.env.35578bf6192b803582efd15d81ad6745}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.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}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: {
            property: "現在作業中",
            status: {
              equals: "作業中"
            }
          }
        })
      }
    );

    const data = await response.json();

    // デバッグ用
    res.status(200).json(data);

  } catch (e) {
    res.status(500).json({
      error: e.toString()
    });
  }
}
