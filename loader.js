const { loadNotionData } = require("./data");

(async () => {
  const logger = console;
  await loadNotionData(logger);
  logger.info("🦕 Dewey slack app is running!");
})();
