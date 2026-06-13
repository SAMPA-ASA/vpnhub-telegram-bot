import assert from "node:assert/strict";

import { handleUpdate } from "../src/bot.js";
import { getSettings, getSession, listAdmins, listProtocols, setSession, setSetting, upsertAdmin } from "../src/storage.js";
import { statusKeyboard } from "../src/ui.js";
import { installTelegramMock } from "../test-support/telegram-mock.js";
import { createMockEnv } from "../test-support/mock-d1.js";

export const tests = [
  {
    name: "responds to /start for the owner",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            message: {
              message_id: 1,
              chat: { id: 111, type: "private", first_name: "Owner" },
              from: { id: 111, first_name: "Owner" },
              text: "/start",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("@destination"));
        assert.ok(String(sendMessageCall.init.body).includes("chat_id"));
        assert.ok(String(sendMessageCall.init.body).includes("menu:status"));
        assert.ok(String(sendMessageCall.init.body).includes("menu:protocols"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "shows the disclaimer to the owner",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            message: {
              message_id: 1,
              chat: { id: 111, type: "private", first_name: "Owner" },
              from: { id: 111, first_name: "Owner" },
              text: "/disclaimer",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);

        const body = String(sendMessageCall.init.body);
        assert.ok(body.includes("اطلاعیه شفافیت، حریم خصوصی و سلب مسئولیت"));
        assert.ok(body.includes("این ربات تلگرامی صرفاً با هدف بازنشر کانفیگ‌های منتشرشده در کانال‌های عمومی"));
        assert.ok(!body.includes("reply_markup"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "shows the guest main menu in black list mode",
    fn: async () => {
      const env = createMockEnv({
        OWNER_CHAT_ID: "111",
        TARGET_CHANNEL_ID: "@destination",
        ADMIN_CHANNEL_ID: "@developer_channel",
        ADMIN_SUPPORT_DIRECT_URL: "https://t.me/vpnhub_support",
      });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            message: {
              message_id: 2,
              chat: { id: 222, type: "private", first_name: "Guest" },
              from: { id: 222, first_name: "Guest" },
              text: "/start",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);

        const body = String(sendMessageCall.init.body);
        assert.ok(body.includes("درود ❤️"));
        assert.ok(body.includes("من ربات کانال VPN Hub هستم."));
        assert.ok(body.includes("@destination"));
        assert.ok(body.includes("@developer_channel"));
        assert.ok(body.includes("https://t.me/vpnhub_support"));
        assert.ok(body.includes("کانال خودون"));
        assert.ok(body.includes("بدون هیچ دسترسی، ادمین کنید."));
        assert.ok(body.includes("کانال تلگرمی توسعه دهنده"));
        assert.ok(body.includes("پشتیبانی"));
        assert.ok(body.includes("https://t.me/destination"));
        assert.ok(body.includes("https://t.me/developer_channel"));
        assert.ok(!body.includes("menu:status"));
        assert.ok(!body.includes("act:send_message"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "shows the disclaimer to a regular user without changing the active session",
    fn: async () => {
      const env = createMockEnv({
        OWNER_CHAT_ID: "111",
        TARGET_CHANNEL_ID: "@destination",
      });
      const mock = installTelegramMock();

      try {
        await setSession(env, "222", "protocol_add", { step: 1 }, 30);

        await handleUpdate(
          {
            message: {
              message_id: 4,
              chat: { id: 222, type: "private", first_name: "Guest" },
              from: { id: 222, first_name: "Guest" },
              text: "/disclaimer",
            },
          },
          env,
        );

        const session = await getSession(env, "222");
        assert.equal(session?.state, "protocol_add");
        assert.equal(Number(session?.data?.step), 1);

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("اطلاعیه شفافیت، حریم خصوصی و سلب مسئولیت"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "shows the guest white-list onboarding text",
    fn: async () => {
      const env = createMockEnv({
        OWNER_CHAT_ID: "111",
        TARGET_CHANNEL_ID: "@destination",
        ADMIN_CHANNEL_ID: "@developer_channel",
        ADMIN_SUPPORT_DIRECT_URL: "https://t.me/vpnhub_support",
      });
      const mock = installTelegramMock();

      try {
        await setSetting(env, "copy_mode", "white");

        await handleUpdate(
          {
            message: {
              message_id: 3,
              chat: { id: 333, type: "private", first_name: "Guest" },
              from: { id: 333, first_name: "Guest" },
              text: "/menu",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);

        const body = String(sendMessageCall.init.body);
        assert.ok(body.includes("کانال خودتون رو به پشتیبانی، معرفی کنید."));
        assert.ok(body.includes("@destination"));
        assert.ok(body.includes("@developer_channel"));
        assert.ok(body.includes("https://t.me/vpnhub_support"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "renders Persian status buttons",
    fn: async () => {
      const keyboard = statusKeyboard("black", {
        is_owner: 1,
        can_toggle_bot: 1,
        can_manage_mode: 1,
      });

      const texts = keyboard.inline_keyboard.flat().map((button) => button.text);
      assert.ok(texts.includes("روشن/خاموش"));
      assert.ok(texts.includes("🏠 منوی اصلی"));
      assert.ok(texts.includes("Black List ✅"));
      assert.ok(texts.includes("White List"));
    },
  },
  {
    name: "toggles bot state from the status menu",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-toggle-bot",
              from: { id: 111 },
              message: { message_id: 9, chat: { id: 111 } },
              data: "toggle:bot",
            },
          },
          env,
        );

        const settings = await getSettings(env);
        assert.equal(settings.enabled, "0");

        const statusCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("toggle:bot"));
        assert.ok(statusCall);
        assert.ok(String(statusCall.init.body).includes("خاموش ❌"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "changes copy mode from the status menu",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-mode-black",
              from: { id: 111 },
              message: { message_id: 10, chat: { id: 111 } },
              data: "mode:black",
            },
          },
          env,
        );

        const settings = await getSettings(env);
        assert.equal(settings.copy_mode, "black");

        const statusCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("mode:black"));
        assert.ok(statusCall);
        assert.ok(String(statusCall.init.body).includes("Black List ✅"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "resets the active session when /start is sent",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await setSession(env, "111", "protocol_add", { step: 1 }, 30);

        await handleUpdate(
          {
            message: {
              message_id: 2,
              chat: { id: 111, type: "private", first_name: "Owner" },
              from: { id: 111, first_name: "Owner" },
              text: "/start",
            },
          },
          env,
        );

        const session = await getSession(env, "111");
        assert.equal(session, null);

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("menu:status"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "returns to the previous menu when /cancel is sent",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await setSession(env, "111", "protocol_add", {}, 30);

        await handleUpdate(
          {
            message: {
              message_id: 3,
              chat: { id: 111, type: "private", first_name: "Owner" },
              from: { id: 111, first_name: "Owner" },
              text: "/cancel",
            },
          },
          env,
        );

        const session = await getSession(env, "111");
        assert.equal(session, null);

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage") && String(call.init.body).includes("✅ عملیات لغو شد."));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("act:protocol_add"));
        assert.ok(String(sendMessageCall.init.body).includes("act:protocol_search"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "opens the admin menu and completes the add-admin flow",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await setSession(env, "111", "protocol_add", {}, 30);

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admins",
              from: { id: 111 },
              message: { message_id: 22, chat: { id: 111 } },
              data: "menu:admins",
            },
          },
          env,
        );

        const sessionAfterMenu = await getSession(env, "111");
        assert.equal(sessionAfterMenu, null);
        assert.ok(mock.calls.some((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("act:admins_add")));

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admin-add",
              from: { id: 111 },
              message: { message_id: 23, chat: { id: 111 } },
              data: "act:admins_add",
            },
          },
          env,
        );

        let session = await getSession(env, "111");
        assert.equal(session?.state, "admin_add");

        await handleUpdate(
          {
            message: {
              message_id: 24,
              chat: { id: 111, type: "private" },
              from: { id: 111, first_name: "Owner" },
              text: "222",
            },
          },
          env,
        );

        session = await getSession(env, "111");
        assert.equal(session?.state, "admin_perm");
        assert.ok(mock.calls.some((call) => call.url.includes("/sendMessage") && String(call.init.body).includes("Chat ID")));

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admin-perm",
              from: { id: 111 },
              message: { chat: { id: 111 } },
              data: "perm:all",
            },
          },
          env,
        );

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admin-save",
              from: { id: 111 },
              message: { chat: { id: 111 } },
              data: "perm:save",
            },
          },
          env,
        );

        const admins = await listAdmins(env);
        const createdAdmin = admins.find((row) => String(row.chat_id) === "222");
        assert.ok(createdAdmin);
        assert.equal(Number(createdAdmin.can_toggle_bot), 1);
        assert.equal(Number(createdAdmin.can_manage_protocol_delete), 1);
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "hides protocol and target-channel buttons from admins without permission",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await upsertAdmin(
          env,
          "222",
          {
            can_toggle_bot: false,
            can_manage_whitelist: true,
            can_manage_blacklist: false,
            can_manage_mode: false,
            can_manage_target_channel: false,
            can_manage_protocol_add: false,
            can_manage_protocol_edit: false,
            can_manage_protocol_delete: false,
          },
          "Whitelist Manager",
        );

        await handleUpdate(
          {
            message: {
              message_id: 1,
              chat: { id: 222, type: "private", first_name: "Manager" },
              from: { id: 222, first_name: "Manager" },
              text: "/start",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(!String(sendMessageCall.init.body).includes("menu:protocols"));
        assert.ok(String(sendMessageCall.init.body).includes("menu:lists"));
        assert.ok(!String(sendMessageCall.init.body).includes("act:target_channel"));

        await handleUpdate(
          {
            callback_query: {
              id: "cb-lists",
              from: { id: 222 },
              message: { message_id: 2, chat: { id: 222 } },
              data: "menu:lists",
            },
          },
          env,
        );

        const listMenuCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("menu:black_list"));
        assert.ok(listMenuCall === undefined);
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "hides status action buttons from admins without toggle or mode access",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await upsertAdmin(
          env,
          "333",
          {
            can_toggle_bot: false,
            can_manage_whitelist: true,
            can_manage_blacklist: false,
            can_manage_mode: false,
            can_manage_target_channel: false,
            can_manage_protocol_add: false,
            can_manage_protocol_edit: false,
            can_manage_protocol_delete: false,
          },
          "Status Viewer",
        );

        await handleUpdate(
          {
            callback_query: {
              id: "cb-status",
              from: { id: 333 },
              message: { message_id: 10, chat: { id: 333 } },
              data: "menu:status",
            },
          },
          env,
        );

        const statusCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("وضعیت سرویس"));
        assert.ok(statusCall);
        assert.ok(!String(statusCall.init.body).includes("toggle:bot"));
        assert.ok(!String(statusCall.init.body).includes("mode:black"));
        assert.ok(!String(statusCall.init.body).includes("mode:white"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "opens admin edit by inline selection",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await upsertAdmin(
          env,
          "222",
          {
            can_toggle_bot: false,
            can_manage_whitelist: true,
            can_manage_blacklist: false,
            can_manage_mode: false,
            can_manage_target_channel: false,
            can_manage_protocol_add: false,
            can_manage_protocol_edit: false,
            can_manage_protocol_delete: false,
          },
          "Whitelist Manager",
        );

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admin-edit",
              from: { id: 111 },
              message: { message_id: 30, chat: { id: 111 } },
              data: "act:admins_edit",
            },
          },
          env,
        );

        const selectionCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("act:admins_edit_pick:222"));
        assert.ok(selectionCall);
        assert.ok(!String(selectionCall.init.body).includes("act:admins_edit_pick:111"));

        await handleUpdate(
          {
            callback_query: {
              id: "cb-admin-edit-pick",
              from: { id: 111 },
              message: { message_id: 31, chat: { id: 111 } },
              data: "act:admins_edit_pick:222",
            },
          },
          env,
        );

        const permissionCall = mock.calls.find((call) => call.url.includes("/editMessageText") && String(call.init.body).includes("can_manage_target_channel"));
        assert.ok(permissionCall);
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "forwards matching configs from allowed channels",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            channel_post: {
              message_id: 5,
              chat: {
                id: -100222,
                type: "channel",
                username: "source_channel",
                title: "Source Channel",
              },
              text: "new config vless://abc123",
            },
          },
          env,
        );

        const sendMessageCall = mock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("@destination"));
        assert.ok(String(sendMessageCall.init.body).includes("@source_channel"));
        assert.ok(String(sendMessageCall.init.body).includes("vless://abc123"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "does not forward posts that originate from the target channel",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            channel_post: {
              message_id: 6,
              chat: {
                id: -100333,
                type: "channel",
                username: "destination",
                title: "Destination",
              },
              text: "new config vless://abc123",
            },
          },
          env,
        );

        assert.ok(!mock.calls.some((call) => call.url.includes("/sendMessage")));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "restores backup from uploaded json file after confirmation",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mockBackup = {
        exported_at: new Date().toISOString(),
        settings: [
          { key: "enabled", value: "1" },
          { key: "copy_mode", value: "white" },
          { key: "target_channel_id", value: "@destination" },
        ],
        protocols: [
          {
            id: 1,
            pattern: "custom://",
            type_name: "CustomVPN",
            enabled: 1,
            created_by: "tester",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        channel_lists: [
          {
            id: 1,
            list_type: "white",
            channel_key: "@allowed",
            channel_username: "allowed",
            channel_title: "Allowed Channel",
            created_by: "tester",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        admins: [
          {
            chat_id: "111",
            display_name: "Owner",
            is_owner: 1,
            can_toggle_bot: 1,
            can_manage_whitelist: 1,
            can_manage_blacklist: 1,
            can_manage_mode: 1,
            can_manage_target_channel: 1,
            can_manage_protocol_add: 1,
            can_manage_protocol_edit: 1,
            can_manage_protocol_delete: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        sessions: [],
      };

      const telegramMock = installTelegramMock({
        telegramFiles: {
          "backup-file-id": "backup.json",
          "backup.json": JSON.stringify(mockBackup),
        },
      });

      try {
        await setSession(env, "111", "restore_wait_file", {}, 30);

        await handleUpdate(
          {
            message: {
              message_id: 10,
              chat: { id: 111, type: "private" },
              from: { id: 111, first_name: "Owner" },
              document: { file_id: "backup-file-id" },
            },
          },
          env,
        );

        await handleUpdate(
          {
            callback_query: {
              id: "cb-1",
              from: { id: 111 },
              message: { chat: { id: 111 } },
              data: "confirm:restore_backup:yes",
            },
          },
          env,
        );

        const settings = await getSettings(env);
        const protocols = await listProtocols(env);

        assert.equal(settings.copy_mode, "white");
        assert.ok(protocols.some((row) => row.pattern === "custom://"));
        assert.ok(telegramMock.calls.some((call) => call.url.includes("/sendMessage")));
      } finally {
        telegramMock.restore();
      }
    },
  },
  {
    name: "adds a cancel button to the restore-backup prompt",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-restore-backup",
              from: { id: 111 },
              message: { message_id: 63, chat: { id: 111 } },
              data: "act:restore_backup",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/editMessageText") || call.url.includes("/sendMessage"))
            && body.includes("بازیابی بکاپ")
            && body.includes("act:cancel_edit");
        });

        assert.ok(promptCall);
        assert.ok(String(promptCall.init.body).includes("لغو"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "edits the current callback message instead of sending a new one",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-1",
              from: { id: 111 },
              message: { message_id: 44, chat: { id: 111 } },
              data: "menu:protocols",
            },
          },
          env,
        );

        assert.ok(mock.calls.some((call) => call.url.includes("/editMessageText")));
        assert.ok(!mock.calls.some((call) => call.url.includes("/sendMessage")));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "cancels protocol edit mode from inline button",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await setSession(env, "111", "protocol_edit_pick", {}, 30);

        await handleUpdate(
          {
            callback_query: {
              id: "cb-2",
              from: { id: 111 },
              message: { message_id: 55, chat: { id: 111 } },
              data: "act:cancel_edit",
            },
          },
          env,
        );

        const session = await getSession(env, "111");
        assert.equal(session, null);
        assert.ok(mock.calls.some((call) => call.url.includes("/editMessageText")));
        assert.ok(!mock.calls.some((call) => call.url.includes("/sendMessage")));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "adds a cancel button to the send-message prompt",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-send-message",
              from: { id: 111 },
              message: { message_id: 60, chat: { id: 111 } },
              data: "act:send_message",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/editMessageText") || call.url.includes("/sendMessage"))
            && body.includes("تأیید نهایی گرفته می‌شود")
            && body.includes("act:cancel_edit");
        });

        assert.ok(promptCall);
        assert.ok(String(promptCall.init.body).includes("لغو"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "asks for confirmation and copies the message to the target channel",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await setSession(env, "111", "send_message", {}, 30);

        await handleUpdate(
          {
            message: {
              message_id: 101,
              chat: { id: 111, type: "private", first_name: "Owner" },
              from: { id: 111, first_name: "Owner" },
              text: "Hello channel",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/sendMessage") || call.url.includes("/editMessageText"))
            && body.includes("confirm:send_message:yes")
            && body.includes("confirm:send_message:no");
        });

        assert.ok(promptCall);

        const session = await getSession(env, "111");
        assert.equal(session?.state, "confirm_action");
        assert.equal(session?.data?.type, "send_message");
        assert.equal(session?.data?.sourceChatId, "111");
        assert.equal(session?.data?.sourceMessageId, 101);

        await handleUpdate(
          {
            callback_query: {
              id: "cb-send-message-yes",
              from: { id: 111 },
              message: { message_id: 60, chat: { id: 111 } },
              data: "confirm:send_message:yes",
            },
          },
          env,
        );

        assert.ok(
          mock.calls.some((call) => call.url.includes("/copyMessage")
            && String(call.init.body).includes("\"chat_id\":\"@destination\"")
            && String(call.init.body).includes("\"from_chat_id\":\"111\"")
            && String(call.init.body).includes("\"message_id\":101")),
        );

        const clearedSession = await getSession(env, "111");
        assert.equal(clearedSession, null);
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "adds a cancel button to the white-list add prompt",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-white-add",
              from: { id: 111 },
              message: { message_id: 61, chat: { id: 111 } },
              data: "act:white_add",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/editMessageText") || call.url.includes("/sendMessage"))
            && body.includes("شناسه کانال را برای لیست سفید بفرستید")
            && body.includes("act:cancel_edit");
        });

        assert.ok(promptCall);
        assert.ok(String(promptCall.init.body).includes("لغو"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "adds a cancel button to the protocol search prompt",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-protocol-search",
              from: { id: 111 },
              message: { message_id: 62, chat: { id: 111 } },
              data: "act:protocol_search",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/editMessageText") || call.url.includes("/sendMessage"))
            && body.includes("عبارت جستجو را بفرستید")
            && body.includes("act:cancel_edit");
        });

        assert.ok(promptCall);
        assert.ok(String(promptCall.init.body).includes("لغو"));
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "adds a cancel button to the protocol add prompt",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111", TARGET_CHANNEL_ID: "@destination" });
      const mock = installTelegramMock();

      try {
        await handleUpdate(
          {
            callback_query: {
              id: "cb-protocol-add",
              from: { id: 111 },
              message: { message_id: 64, chat: { id: 111 } },
              data: "act:protocol_add",
            },
          },
          env,
        );

        const promptCall = mock.calls.find((call) => {
          const body = String(call.init.body);
          return (call.url.includes("/editMessageText") || call.url.includes("/sendMessage"))
            && body.includes("pattern | type")
            && body.includes("act:cancel_edit");
        });

        assert.ok(promptCall);
        assert.ok(String(promptCall.init.body).includes("لغو"));
      } finally {
        mock.restore();
      }
    },
  },
];
