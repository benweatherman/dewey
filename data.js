const url = require("url");
const { Client } = require("@notionhq/client");
const _redis = require("redis");

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Special Redis-to-go handling for redis client
// https://devcenter.heroku.com/articles/redistogo#using-with-node-js
const rtg = url.parse(process.env.REDISTOGO_URL);
const redis = _redis.createClient(rtg.port, rtg.hostname);
redis.auth(rtg.auth.split(":")[1]);

redis.on("error", (err) => {
  console.log("Redis error", err);
});

async function getPageCount(logger) {
  return await redis.get("page-count");
}

async function loadNotionData(logger) {
  const pages = new Map();
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
    pages.set(page.id, pageTitle);
  });

  await redis.set("page-count", pages.size);

  const requests = Array.from(pages.entries(), async ([pageID, pageTitle]) => {
    const newSections = await getSections(pageID, pageTitle, logger);
    for (const [sectionName, sectionData] of newSections.entries()) {
      redis.hSet(`section-${sectionName}`, sectionData);
    }
  });

  await Promise.all(requests);
}

async function getSections(pageID, pageTitle, logger) {
  const sections = new Map();

  const response = await notion.blocks.children.list({
    block_id: pageID,
    page_size: 100,
  });

  logger.info(`Processing children for page '${pageTitle}'`);

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
      sections.set(currentSection, {
        id: result.id,
        page: { id: pageID, title: pageTitle },
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
      sections.get(currentSection).todos.push(todo);

      logger.info(`${todo.checked ? "✅" : "◻️"} ${text}`);
    }
  });

  return sections;
}

module.exports = { loadNotionData, getPageCount };
