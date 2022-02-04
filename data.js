const { Client } = require("@notionhq/client");
const _redis = require("redis");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const redis = _redis.createClient({ url: process.env.REDISTOGO_URL });

redis.on("error", (err) => {
  console.log("Error " + err);
});

async function loadNotionData(logger) {
  const PAGES = new Map();
  const SECTIONS = new Map();

  const response = await notion.search({
    filter: {
      value: "page",
      property: "object",
    },
    page_size: 100,
  });

  logger.info("Loading pages from Notion...");

  response.results.forEach((page) => {
    // This destructuring is very complex, but so is the response object from Notion, so...
    // TODO: documenting the structure here would be helpful
    const {
      title: [
        {
          text: { content: pageTitle },
        },
      ],
    } = page.properties.title;
    PAGES.set(page.id, { id: page.id, title: pageTitle });
  });

  const requests = Array.from(PAGES.entries(), async ([pageID, page]) => {
    const response = await notion.blocks.children.list({
      block_id: pageID,
      page_size: 100,
    });

    logger.info(`Processing children for page '${page.title}'`);

    var currentSection;
    response.results.forEach((result) => {
      if (result.type.startsWith("heading")) {
        const t = result.type;
        const {
          text: [
            {
              text: { content: sectionName },
            },
          ],
        } = result[t];
        currentSection = sectionName;
        SECTIONS.set(currentSection, {
          id: result.id,
          page: page,
          name: sectionName,
          todos: [],
        });

        logger.info(`== ${sectionName}`);
      } else if (result.type === "to_do") {
        const {
          to_do: { checked, text: textChunks },
        } = result;
        const text = textChunks.map((chunk) => chunk.plain_text).join("");

        const todo = { id: result.id, checked, text };
        SECTIONS.get(currentSection).todos.push(todo);

        logger.info(`${todo.checked ? "✅" : "◻️"} ${text}`);
      }
    });
  });

  await Promise.all(requests);
}

module.exports = { loadNotionData };
