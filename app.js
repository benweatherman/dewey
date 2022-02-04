require("polyfill-object.fromentries");
const { App } = require("@slack/bolt");
const { Client } = require("@notionhq/client");
const chunk = require("lodash.chunk");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const PAGES = new Map();
const SECTIONS = new Map();

app.action("refresh_todo_ui", async ({ ack, body, client, logger }) => {
  logger.info("Refreshing TODO UI");
  await ack();

  await refreshHome(client, logger, body.user.id);

  logger.info("Done refreshing TODO UI");
});

app.action("refresh_todo_data", async ({ ack, body, client, logger }) => {
  logger.info("Refreshing TODO data");
  await ack();

  await loadNotionData(logger);

  logger.info("Done refreshing TODO data");
});

app.view(/^add_todo_view/, async ({ ack, payload, body, client, logger }) => {
  logger.info("Handling TODO view submission");
  await ack();

  const sectionName = payload.callback_id.replace(/add_todo_view-/, "");
  const section = SECTIONS.get(sectionName);
  const {
    state: {
      values: {
        todo_text_input_block: {
          todo_input: { value: text },
        },
        todo_details_input_block: {
          details_input: { value: details },
        },
      },
    },
  } = payload;

  logger.info(`Adding TODO in ${sectionName}: ${text}`);
  let content = text;
  if (details && details.length) {
    content += `\n${details}`;
  }
  const response = await notion.blocks.children.append({
    block_id: section.page.id,
    children: [
      {
        object: "block",
        type: "to_do",
        to_do: {
          text: [
            {
              type: "text",
              text: { content },
            },
          ],
        },
      },
    ],
  });

  await loadNotionData(logger);
  await refreshHome(client, logger, body.user.id);

  logger.info("Done handling TODO view submission");
});

app.action("add_todo", async ({ ack, body, payload, client, logger }) => {
  logger.info("Adding TODO");
  await ack();

  const sectionName = payload.block_id.replace(/^todo-section-/, "");
  const section = SECTIONS.get(sectionName);
  logger.info(`Adding TODO in ${sectionName}`);

  try {
    const result = await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: `add_todo_view-${sectionName}`,
        title: {
          type: "plain_text",
          // TODO Can only be 25 characters
          text: "Add TODO",
        },
        blocks: [
          {
            type: "input",
            block_id: "todo_text_input_block",
            label: {
              type: "plain_text",
              text: "TODO",
            },
            element: {
              type: "plain_text_input",
              action_id: "todo_input",
              focus_on_load: true,
              placeholder: {
                type: "plain_text",
                text: "Write the TODO here",
              },
            },
          },
          {
            type: "input",
            block_id: "todo_details_input_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Description",
            },
            element: {
              type: "plain_text_input",
              action_id: "details_input",
              placeholder: {
                type: "plain_text",
                text: "Add more details",
              },
            },
          },
        ],
        submit: {
          type: "plain_text",
          text: "Add TODO",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
      },
    });
    logger.info(result);
  } catch (error) {
    logger.error(error);
  }

  logger.info("Done adding TODO");
});

app.action(/^toggle_todo/, async ({ ack, body, payload, client, logger }) => {
  logger.info("Toggling TODO");
  await ack();

  await loadNotionData(logger);

  const sectionName = payload.block_id.replace(/^todo-section-/, "");
  const section = SECTIONS.get(sectionName);
  logger.info(`TODO toggled in ${sectionName}`);

  const selectedIDs = new Set(
    payload.selected_options.map((option) => {
      const id = option.value.replace(/^notion-id-/, "");
      return id;
    })
  );

  const requests = [];
  section.todos.forEach((todo) => {
    const shouldBeChecked = selectedIDs.has(todo.id);
    const isDifferent = shouldBeChecked !== todo.checked;
    if (isDifferent) {
      logger.info(`TODO toggled ${todo.text} to ${shouldBeChecked}`);
      todo.checked = shouldBeChecked;

      const request = notion.blocks.update({
        block_id: todo.id,
        to_do: {
          checked: todo.checked,
        },
      });
      requests.push(request);
    }
  });

  try {
    await Promise.all(requests);
  } catch (err) {
    // TODO Notion fails fairly often with update conflict errors, but checking
    //      the Notion app shows things were updated correctly :|
    //      {"object":"error","status":409,"code":"conflict_error","message":"Conflict occurred while saving. Please try again."}
    logger.error("Error updating to_do in notion", err);
  }

  await refreshHome(client, logger, body.user.id);

  logger.info("Done toggling TODO");
});

app.event("app_home_opened", async ({ event, client, context, logger }) => {
  logger.info(`<${event.user}> opened home`);
  await refreshHome(client, logger, event.user);
});

async function refreshHome(client, logger, userID) {
  try {
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Say hello to Dewey! :sauropod:",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Dewey lets you view, add, and remove TODO items from a page in Notion.",
        },
      },
    ];

    const pageCount = PAGES.size;

    if (pageCount === 0) {
      blocks.push(
        ...[
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Share a page with Dewey in the Notion app to start setting up your TODOs.`,
            },
          },
        ]
      );
    } else {
      const pageText = pageCount === 1 ? "page" : "pages";
      blocks.push(
        ...[
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Currently, Dewey is monitoring ${pageCount} ${pageText} for TODOs. Share more pages with Dewey to look for more TODOs.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Refresh UI",
                  emoji: true,
                },
                value: "refresh_todo_ui",
                action_id: "refresh_todo_ui",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Fetch Data",
                  emoji: true,
                },
                value: "refresh_todo_data",
                action_id: "refresh_todo_data",
              },
            ],
          },
        ]
      );
    }

    blocks.push({ type: "divider" });

    const completedItems = new Set();

    SECTIONS.forEach((section, sectionName) => {
      logger.info(`== ${sectionName}`);

      const options = section.todos.map((todo, i) => {
        let [text, description] = todo.text.split("\n");
        const value = `notion-id-${todo.id}`;

        if (todo.checked) {
          text = `~${text.trim()}~`;
          if (description) {
            description = `~${description.trim()}~`;
          }

          // TODO This is kinda hacky
          completedItems.add(value);
        }

        const option = {
          value,
          text: { type: "mrkdwn", text },
        };
        if (description) {
          option.description = { type: "mrkdwn", text: description };
        }

        logger.info(`${todo.checked ? "✅" : "◻️"} ${text}`);

        return option;
      });

      const elements = [];
      // Can't have more than 10 checkboxes
      // [ERROR] no more than 10 items allowed [json-pointer:/view/blocks/7/elements/0/options]
      chunk(options, 10).forEach((optionChunk, i) => {
        const checkboxes = {
          type: "checkboxes",
          options: optionChunk,
          action_id: `toggle_todo-slice${i}`,
        };

        const initial_options = optionChunk.filter((option) => {
          logger.info(
            `${option.text.text} is initial? ${completedItems.has(
              option.value
            )}`
          );
          return completedItems.has(option.value);
        });
        // If an empty array is used, slack generates the following error:
        // [ERROR] must be one of the provided options [json-pointer:view/blocks/4/elements/0/initial_options]
        if (initial_options.length) {
          checkboxes.initial_options = initial_options;
        }
        elements.push(checkboxes);
      });
      elements.push({
        type: "button",
        text: {
          type: "plain_text",
          text: "Add +",
          emoji: true,
        },
        action_id: "add_todo",
      });
      blocks.push(
        ...[
          {
            type: "header",
            text: {
              type: "plain_text",
              text: sectionName,
              emoji: true,
            },
          },
          {
            type: "actions",
            block_id: `todo-section-${sectionName}`,
            elements,
          },
          { type: "divider" },
        ]
      );
    });

    const result = await client.views.publish({
      user_id: userID,
      view: {
        type: "home",
        callback_id: "home_view",
        blocks,
      },
    });
  } catch (error) {
    console.error(error);
    console.error(error.data.response_metadata);
  }
}

(async () => {
  // TODO Can I get the logger from app? Looks like it's marked private currently
  const logger = console;
  await loadNotionData(logger);
  await app.start(process.env.PORT || 3000);

  logger.info("🦕 Dewey slack app is running!");
})();
