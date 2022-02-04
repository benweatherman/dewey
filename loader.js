const { loadNotionData, getSections } = require("./data");

(async () => {
  const logger = console;
  await loadNotionData(logger);
  const sections = await getSections(logger);
  logger.info(sections);
  logger.info("🦕 Loaded dewey data!");
})();
