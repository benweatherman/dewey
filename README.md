Bolt app template
=================

[Bolt](https://slack.dev/bolt) is our framework that lets you build JavaScript-based Slack apps in a flash.

This project is a simple app template to make it easy to create your first Bolt app. Read our [Getting Started with Bolt](https://api.slack.com/start/building/bolt) guide for a more in-depth tutorial

Your Project
------------

- `app.js` contains the primary Bolt app. It imports the Bolt package (`@slack/bolt`) and starts the Bolt app's server. It's where you'll add your app's listeners.
- `.env` is where you'll put your Slack app's authorization token and signing secret.
- The `examples/` folder contains a couple of other sample apps that you can peruse to your liking. They show off a few platform features that your app may want to use.


Read the [Getting Started guide](https://api.slack.com/start/building/bolt)
-------------------

Read the [Bolt documentation](https://slack.dev/bolt)
-------------------

\ ゜o゜)ノ

Notes about the Notion API
-------------------

It's marked as Beta, which seems generous.

- Users must share their database/page with an integration before the intgration can access it (no matter what permissions were requested by the integration)
- Looking at network traffic from their webapp, there's a whole different set of APIs they use to build the app (things like getting all top-level pages for a workspace)
- Can't create top-level pages without giving a database or page ID https://stackoverflow.com/questions/68323367/how-to-create-a-top-level-page-with-notion-api
- Need to search to find stuff that's accessible to an integration https://stackoverflow.com/questions/70052185/list-all-databases-accessed-by-integration-on-the-notion

Notes about the slack integration

- Only allowed 10 `options` (TODOs) when building blocks


Development/deployment niceties
---------------
Dump heroku env vars `heroku config --app dewey-dino --shell > .env`
Running locally loading `.env` `env $(grep -v '^#' .env | xargs) npm run start`
Running locally with Heroku `heroku local --port 3000`