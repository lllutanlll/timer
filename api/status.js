export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {

  try {

    const response = await fetch(
      `https://api.notion.com/v1/databases/${process.env.35578bf6192b803582efd15d81ad6745}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.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}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            property: "現在作業中",
            select: {
              equals: "作業中",
            },
          },
        }),
      }
    );

    const data = await response.json();

    return res.status(200).json({
      running: data.results.length > 0,
      debug: data,
    });

  } catch (e) {

    return res.status(500).json({
      error: String(e),
    });

  }

}
