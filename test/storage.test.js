import assert from "node:assert/strict";

import {
  buildBackupData,
  ensureBootstrap,
  getSettings,
  restoreBackupData,
  setSetting,
  upsertAdmin,
  upsertChannelEntry,
  upsertProtocol,
  listProtocols,
  listChannelLists,
  listAdmins,
} from "../src/storage.js";
import { PERMISSIONS } from "../src/constants.js";
import { createMockEnv, blankPermissionsMap } from "../test-support/mock-d1.js";

export const tests = [
  {
    name: "builds and restores a backup round-trip",
    fn: async () => {
      const env = createMockEnv({ OWNER_CHAT_ID: "111" });

      await upsertProtocol(env, "111", "custom://", "CustomVPN");
      await upsertChannelEntry(env, "111", "white", {
        channelKey: "@source",
        channelUsername: "source",
        channelTitle: "Source Channel",
      });
      await upsertAdmin(
        env,
        "222",
        {
          can_toggle_bot: true,
          can_manage_whitelist: false,
          can_manage_blacklist: true,
          can_manage_mode: false,
          can_manage_protocol_add: true,
          can_manage_protocol_edit: false,
          can_manage_protocol_delete: false,
        },
        "Moderator",
      );
      await setSetting(env, "copy_mode", "white");

      const backup = await buildBackupData(env);
      assert.equal(backup.protocols.length >= 1, true);
      assert.equal(backup.channel_lists.length >= 1, true);
      assert.equal(backup.admins.length >= 1, true);

      await env.DB.exec(`
        DELETE FROM settings;
        DELETE FROM protocols;
        DELETE FROM channel_lists;
        DELETE FROM admins;
        DELETE FROM sessions;
      `);

      await restoreBackupData(env, backup);

      const settings = await getSettings(env);
      const protocols = await listProtocols(env);
      const channelLists = await listChannelLists(env, "white");
      const admins = await listAdmins(env);

      assert.equal(settings.copy_mode, "white");
      assert.ok(protocols.some((row) => row.pattern === "custom://"));
      assert.ok(channelLists.some((row) => row.channel_key === "@source"));
      assert.ok(admins.some((row) => row.chat_id === "222"));
      assert.ok(admins.some((row) => row.chat_id === "111"));
    },
  },
  {
    name: "stores settings and permissions consistently",
    fn: async () => {
      const env = createMockEnv();
      await setSetting(env, "enabled", "0");
      const settings = await getSettings(env);
      assert.equal(settings.enabled, "0");

      const permissions = blankPermissionsMap();
      for (const [key] of PERMISSIONS.slice(0, 3)) {
        permissions[key] = true;
      }

      await upsertAdmin(env, "777", permissions, "Tester");
      const admins = await listAdmins(env);
      const admin = admins.find((row) => row.chat_id === "777");
      assert.ok(admin);
      assert.equal(Number(admin.can_toggle_bot), 1);
      assert.equal(Number(admin.can_manage_blacklist), 1);
      assert.equal(Number(admin.can_manage_protocol_add), 0);
    },
  },
  {
    name: "bootstraps D1 with complete SQL statements",
    fn: async () => {
      const env = createMockEnv();
      const statements = [];
      const originalExec = env.DB.exec.bind(env.DB);

      env.DB.exec = async (sql) => {
        const text = String(sql).trim();
        statements.push(text);
        assert.equal(text.endsWith(";"), true, `bootstrap SQL must end with a semicolon: ${text}`);
        assert.equal(/[\r\n]/.test(text), false, `bootstrap SQL must be single-line: ${text}`);
        return originalExec(sql);
      };

      await ensureBootstrap(env);

      assert.ok(statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS settings")));
      assert.ok(statements.some((statement) => statement.includes("CREATE INDEX IF NOT EXISTS idx_protocols_enabled_pattern")));
    },
  },
];
