const { Client } = require("@notionhq/client");
const _redis = require("redis");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const redis = _redis.createClient({
  url: process.env.REDISCLOUD_URL,
  no_ready_check: true,
});

redis.on("error", (err) => {
  console.error("Redis error", err);
});

class Section {
  id;
  name;

  constructor(name, { id = null, pageID = null, todos = [] } = {}) {
    this.name = name;
    this.id = id;
    this.todos = todos;
    this.pageID = pageID;
  }
}

class TODO {
  id;
  text;
  complete = false;

  constructor(text, { complete = false, id = null, sectionID = null } = {}) {
    this.text = text;
    this.complete = complete;
    this.id = id;
    this.sectionID = sectionID;
  }
}

/**
 * Returns the number of pages that are being indexed
 * @param {Logger} logger - An object for logging things
 * @return {number} - The number of pages being indexed
 */
async function getPageCount(logger) {
  await redis.connect();
  const count = await redis.get("page-count");
  await redis.disconnect();
  return parseInt(count);
}

/**
 * Return a Section for the given section ID
 * @param {string} sectionID - The Notion section ID
 * @param {Logger} logger - An object for logging things
 * @return {Section} - The Section object for the given section ID
 */
async function getSection(sectionID, logger) {
  logger.info(`Getting section info for ${sectionID}`);
  await redis.connect();
  const sectionData = await redis.hGetAll(`section-${sectionID}`);
  const todoIDs = await redis.lRange(`section-todos-${sectionID}`, 0, -1);
  const todoPromises = todoIDs.map(async (todoID) => {
    const todoData = await redis.hGetAll(`todo-${todoID}`);
    const todo = new TODO(todoData.text, {
      id: todoData.id,
      complete: todoData.complete === "true",
      sectionID: todoData.sectionID,
    });
    return Promise.resolve(todo);
  });
  const todos = await Promise.all(todoPromises);

  const section = new Section(sectionData.name, {
    id: sectionData.id,
    pageID: sectionData.pageID,
    todos,
  });

  logger.info(`Fetched section ${section.name} from redis`, section);
  await redis.disconnect();

  return section;
}

/**
 * Returns all `Section`s
 * @param {Logger} logger - An object for logging things
 * @return {[Section]} - An array of all Sections
 */
async function getSections(logger) {
  await redis.connect();

  const todoIDs = await redis.sMembers("todos");
  const sectionIDs = new Set();
  const todoPromises = todoIDs.map(async (todoID) => {
    const key = `todo-${todoID}`;
    const todoData = await redis.hGetAll(key);

    const todo = new TODO(todoData.text, {
      id: todoData.id,
      complete: todoData.complete === "true",
      sectionID: todoData.sectionID,
    });

    sectionIDs.add(todoData.sectionID);

    return Promise.resolve([todoID, todo]);
  });

  const todosByID = new Map(await Promise.all(todoPromises));
  const sectionPromises = Array.from(sectionIDs).map(async (sectionID) => {
    const key = `section-${sectionID}`;
    const sectionData = await redis.hGetAll(key);

    const todoIDs = await redis.lRange(`section-todos-${sectionID}`, 0, -1);
    const todos = todoIDs.map((todoID) => {
      return todosByID.get(todoID);
    });
    todos.reverse();

    const section = new Section(sectionData.name, {
      id: sectionData.id,
      pageID: sectionData.pageID,
      todos,
    });
    return section;
  });

  const sections = await Promise.all(sectionPromises);
  sections.reverse();

  await redis.disconnect();

  return sections;
}

/**
 * Load data from Notion into a datastore
 * @param {Logger} logger - An object for logging things
 */
async function loadNotionData(logger) {
  const response = await notion.search({
    filter: {
      value: "page",
      property: "object",
    },
    page_size: 100,
  });

  logger.info("Loading pages from Notion...");

  let pageCount = 0;
  const requests = response.results.map(async (page) => {
    // This destructuring is very complex, but so is the response object from Notion, so...
    // TODO: documenting the structure here would be helpful
    const {
      title: [
        {
          text: { content: pageTitle },
        },
      ],
    } = page.properties.title;
    pageCount += 1;
    return syncPageData(page.id, pageTitle, logger);
  });

  await redis.connect();
  await redis.set("page-count", pageCount);

  await Promise.all(requests);
  try {
    await redis.disconnect();
  } catch (err) {
    logger.warning("Unable to disconnect from redis", err);
  }
}

/**
 * Syncs data for a given page
 * @param {string} pageID - The Notion page ID to sync
 * @param {string} pageTitle - The Notion page title to sync
 * @param {Logger} logger - An object for logging things
 */
async function syncPageData(pageID, pageTitle, logger) {
  const response = await notion.blocks.children.list({
    block_id: pageID,
    page_size: 100,
  });

  logger.info(`Processing children for page '${pageTitle}'`);

  var currentSectionID;
  const promises = response.results.map(async (result) => {
    if (result.type.startsWith("heading")) {
      const t = result.type;
      const {
        text: [
          {
            text: { content: sectionName },
          },
        ],
      } = result[t];
      currentSectionID = result.id;

      logger.info(`== ${sectionName}`);
      return Promise.all([
        redis.hSet(`section-${result.id}`, {
          name: sectionName,
          id: result.id,
          pageID,
        }),
        redis.del(`section-todos-${result.id}`),
        redis.sAdd("sections", result.id),
      ]);
    } else if (result.type === "to_do") {
      const {
        to_do: { checked, text: textChunks },
      } = result;
      const text = textChunks.map((chunk) => chunk.plain_text).join("");

      return Promise.all([
        redis.hSet(`todo-${result.id}`, {
          text,
          complete: checked,
          id: result.id,
          sectionID: currentSectionID,
        }),
        redis.lPush(`section-todos-${currentSectionID}`, result.id),
        redis.sAdd("todos", result.id),
      ]);
    }
  });

  return Promise.all(promises);
}

module.exports = { loadNotionData, getPageCount, getSection, getSections };
