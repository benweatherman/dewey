const { loadNotionData } = require("./data");

(async () => {
  const logger = console;
  await loadNotionData(logger);
  logger.info("🦕 Loaded dewey data!");
})();
