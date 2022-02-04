# Meet Dewey!

Dewey is a TODO-loving dino bringing Notion's TODO functionality to slack

## Notes about the Notion API

It's marked as Beta, which seems generous.

- Users must share their database/page with an integration before the intgration can access it (no matter what permissions were requested by the integration)
- Looking at network traffic from their webapp, there's a whole different set of APIs they use to build the app (things like getting all top-level pages for a workspace)
- Can't create top-level pages without giving a database or page ID https://stackoverflow.com/questions/68323367/how-to-create-a-top-level-page-with-notion-api
- Need to search to find stuff that's accessible to an integration https://stackoverflow.com/questions/70052185/list-all-databases-accessed-by-integration-on-the-notion

## Notes about the slack integration

- Only allowed 10 `options` (TODOs) when building blocks

## Development/deployment niceties

- Dump heroku env vars `heroku config --app dewey-dino --shell > .env`
- Running locally loading `.env` `env $(grep -v '^#' .env | xargs) npm run start`
- Running locally with Heroku `heroku local --port 3000`
