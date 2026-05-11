export default async function handler(req, res) {

  try {

    const response = await fetch(
      `https://api.notion.com/v1/databases/${process.env.2f378bf6192b80098045e4aff932aff1}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.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}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
      }
    );

    const text = await response.text();

    return res.status(200).send(text);

  } catch (e) {

    return res.status(200).send(String(e));

  }

}
