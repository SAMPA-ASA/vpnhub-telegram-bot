import { DEFAULT_SETTINGS, PERMISSIONS } from "../src/constants.js";
import { clonePermissions, nowIso } from "../src/utils.js";

export class MockD1Database {
  constructor(initial = {}) {
    this.tables = {
      settings: [],
      protocols: [],
      channel_lists: [],
      admins: [],
      sessions: [],
      ...initial,
    };

    this.autoIds = {
      protocols: this.tables.protocols.length
        ? Math.max(...this.tables.protocols.map((row) => row.id || 0)) + 1
        : 1,
      channel_lists: this.tables.channel_lists.length
        ? Math.max(...this.tables.channel_lists.map((row) => row.id || 0)) + 1
        : 1,
    };
  }

  async exec(sql) {
    const normalized = normalizeSql(sql);
    if (normalized.includes("delete from settings")) this.tables.settings = [];
    if (normalized.includes("delete from protocols")) this.tables.protocols = [];
    if (normalized.includes("delete from channel_lists")) this.tables.channel_lists = [];
    if (normalized.includes("delete from admins")) this.tables.admins = [];
    if (normalized.includes("delete from sessions")) this.tables.sessions = [];
    return { success: true };
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      await statement.run();
    }
  }

  resetToDefaults() {
    this.tables.settings = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
    this.tables.protocols = [];
    this.tables.channel_lists = [];
    this.tables.admins = [];
    this.tables.sessions = [];
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    return this.db.execute(this.sql, this.args);
  }

  async first() {
    const result = await this.db.execute(this.sql, this.args);
    return result?.results?.[0] || null;
  }

  async all() {
    return this.db.execute(this.sql, this.args);
  }
}

MockD1Database.prototype.execute = function execute(sql, args) {
  const normalized = normalizeSql(sql);

  if (normalized === "insert or ignore into settings(key, value) values (?, ?)") {
    const [key, value] = args;
    upsertSetting(this.tables.settings, key, value, true);
    return okResult();
  }

  if (normalized === "insert into settings(key, value) values (?, ?)") {
    const [key, value] = args;
    upsertSetting(this.tables.settings, key, value, false);
    return okResult();
  }

  if (normalized === "select key, value from settings") {
    return { results: this.tables.settings.map((row) => ({ ...row })) };
  }

  if (normalized === "select count(*) as count from protocols") {
    return { results: [{ count: this.tables.protocols.length }] };
  }

  if (normalized.startsWith("insert or ignore into protocols(")) {
    const [pattern, typeName, createdBy, createdAt, updatedAt] = args;
    insertOrUpdateProtocol(
      this.tables.protocols,
      this.autoIds,
      {
        pattern,
        type_name: typeName,
        enabled: 1,
        created_by: createdBy,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      true,
    );
    return okResult();
  }

  if (
    normalized.startsWith(
      "insert into protocols(pattern, type_name, enabled, created_by, created_at, updated_at) values (?, ?, 1, ?, ?, ?) on conflict(pattern) do update set",
    )
  ) {
    const [pattern, typeName, createdBy, createdAt, updatedAt] = args;
    insertOrUpdateProtocol(
      this.tables.protocols,
      this.autoIds,
      {
        pattern,
        type_name: typeName,
        enabled: 1,
        created_by: createdBy,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      false,
    );
    return okResult();
  }

  if (normalized === "select * from protocols order by id desc limit 200") {
    return { results: sortByIdDesc(this.tables.protocols) };
  }

  if (normalized === "select * from protocols where enabled = 1 order by length(pattern) desc, id asc") {
    return {
      results: [...this.tables.protocols]
        .filter((row) => Number(row.enabled) === 1)
        .sort((a, b) => String(b.pattern).length - String(a.pattern).length || a.id - b.id)
        .map((row) => ({ ...row })),
    };
  }

  if (normalized === "select * from protocols where id = ? limit 1") {
    const [id] = args;
    return { results: this.tables.protocols.filter((row) => String(row.id) === String(id)).map((row) => ({ ...row })) };
  }

  if (normalized === "select * from protocols") {
    return { results: this.tables.protocols.map((row) => ({ ...row })) };
  }

  if (normalized === "update protocols set pattern = ?, type_name = ?, enabled = 1, updated_at = ? where id = ?") {
    const [pattern, typeName, updatedAt, id] = args;
    const row = this.tables.protocols.find((entry) => String(entry.id) === String(id));
    if (row) {
      row.pattern = pattern;
      row.type_name = typeName;
      row.enabled = 1;
      row.updated_at = updatedAt;
    }
    return okResult();
  }

  if (normalized === "delete from protocols where id = ?") {
    const [id] = args;
    this.tables.protocols = this.tables.protocols.filter((row) => String(row.id) !== String(id));
    return okResult();
  }

  if (normalized === "select * from channel_lists where list_type = ? order by id desc limit 200") {
    const [listType] = args;
    return { results: sortByIdDesc(this.tables.channel_lists.filter((row) => row.list_type === listType)) };
  }

  if (normalized === "select * from channel_lists where list_type = ? and channel_key = ? limit 1") {
    const [listType, channelKey] = args;
    return {
      results: this.tables.channel_lists
        .filter((row) => row.list_type === listType && row.channel_key === channelKey)
        .map((row) => ({ ...row })),
    };
  }

  if (normalized.startsWith("select list_type, channel_key from channel_lists where channel_key in (")) {
    const keys = args.map(String);
    return {
      results: this.tables.channel_lists
        .filter((row) => keys.includes(row.channel_key))
        .map((row) => ({ list_type: row.list_type, channel_key: row.channel_key })),
    };
  }

  if (
    normalized.startsWith(
      "insert into channel_lists(list_type, channel_key, channel_username, channel_title, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(list_type, channel_key) do update set",
    )
  ) {
    const [listType, channelKey, username, title, createdBy, createdAt, updatedAt] = args;
    upsertChannelList(this.tables.channel_lists, this.autoIds, {
      list_type: listType,
      channel_key: channelKey,
      channel_username: username,
      channel_title: title,
      created_by: createdBy,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into channel_lists(") && normalized.includes("values (?, ?, ?, ?, ?, ?, ?)")) {
    const [listType, channelKey, username, title, createdBy, createdAt, updatedAt] = args;
    upsertChannelList(this.tables.channel_lists, this.autoIds, {
      list_type: listType,
      channel_key: channelKey,
      channel_username: username,
      channel_title: title,
      created_by: createdBy,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized === "delete from channel_lists where list_type = ? and channel_key = ?") {
    const [listType, channelKey] = args;
    this.tables.channel_lists = this.tables.channel_lists.filter(
      (row) => !(row.list_type === listType && row.channel_key === channelKey),
    );
    return okResult();
  }

  if (normalized === "select * from admins where chat_id = ? limit 1") {
    const [chatId] = args;
    return { results: this.tables.admins.filter((row) => String(row.chat_id) === String(chatId)).map((row) => ({ ...row })) };
  }

  if (normalized === "select chat_id from admins where chat_id = ? limit 1") {
    const [chatId] = args;
    return { results: this.tables.admins.filter((row) => String(row.chat_id) === String(chatId)).map((row) => ({ chat_id: row.chat_id })) };
  }

  if (normalized === "select * from admins order by is_owner desc, updated_at desc") {
    return {
      results: [...this.tables.admins]
        .sort((a, b) => Number(b.is_owner) - Number(a.is_owner) || String(b.updated_at).localeCompare(String(a.updated_at)))
        .map((row) => ({ ...row })),
    };
  }

  if (normalized === "select * from admins order by is_owner desc, chat_id asc") {
    return {
      results: [...this.tables.admins]
        .sort((a, b) => Number(b.is_owner) - Number(a.is_owner) || String(a.chat_id).localeCompare(String(b.chat_id)))
        .map((row) => ({ ...row })),
    };
  }

  if (normalized.startsWith("insert into admins(") && normalized.includes("on conflict(chat_id) do update set")) {
    const values = args;
    if (values.length >= 11) {
      const [chatId, displayName, ...rest] = values;
      const permissions = rest.slice(0, 8).map(Number);
      const existing = this.tables.admins.find((row) => String(row.chat_id) === String(chatId));
      const createdAt = values[10];
      const updatedAt = values[11];
      upsertAdminRow(this.tables.admins, {
        chat_id: chatId,
        display_name: displayName,
        is_owner: 0,
        can_toggle_bot: permissions[0],
        can_manage_whitelist: permissions[1],
        can_manage_blacklist: permissions[2],
        can_manage_mode: permissions[3],
        can_manage_target_channel: permissions[4],
        can_manage_protocol_add: permissions[5],
        can_manage_protocol_edit: permissions[6],
        can_manage_protocol_delete: permissions[7],
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt,
      });
    } else {
      const [
        chatId,
        displayName,
        isOwner,
        canToggleBot,
        canManageWhitelist,
        canManageBlacklist,
        canManageMode,
        canManageTargetChannel,
        canManageProtocolAdd,
        canManageProtocolEdit,
        canManageProtocolDelete,
        createdAt,
        updatedAt,
      ] = values;
      upsertAdminRow(this.tables.admins, {
        chat_id: chatId,
        display_name: displayName,
        is_owner: Number(isOwner),
        can_toggle_bot: Number(canToggleBot),
        can_manage_whitelist: Number(canManageWhitelist),
        can_manage_blacklist: Number(canManageBlacklist),
        can_manage_mode: Number(canManageMode),
        can_manage_target_channel: Number(canManageTargetChannel),
        can_manage_protocol_add: Number(canManageProtocolAdd),
        can_manage_protocol_edit: Number(canManageProtocolEdit),
        can_manage_protocol_delete: Number(canManageProtocolDelete),
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }
    return okResult();
  }

  if (normalized === "update admins set display_name = ?, updated_at = ? where chat_id = ?") {
    const [displayName, updatedAt, chatId] = args;
    const row = this.tables.admins.find((entry) => String(entry.chat_id) === String(chatId));
    if (row) {
      row.display_name = displayName;
      row.updated_at = updatedAt;
    }
    return okResult();
  }

  if (normalized === "delete from admins where chat_id = ?") {
    const [chatId] = args;
    this.tables.admins = this.tables.admins.filter((row) => String(row.chat_id) !== String(chatId));
    return okResult();
  }

  if (normalized === "select * from settings order by key") {
    return { results: this.tables.settings.map((row) => ({ ...row })) };
  }

  if (normalized === "select * from channel_lists order by list_type, id") {
    return {
      results: [...this.tables.channel_lists]
        .sort((a, b) => a.list_type.localeCompare(b.list_type) || a.id - b.id)
        .map((row) => ({ ...row })),
    };
  }

  if (normalized === "select * from sessions order by updated_at desc") {
    return {
      results: [...this.tables.sessions]
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map((row) => ({ ...row })),
    };
  }

  if (normalized === "select * from admins order by is_owner desc, chat_id asc") {
    return {
      results: [...this.tables.admins]
        .sort((a, b) => Number(b.is_owner) - Number(a.is_owner) || String(a.chat_id).localeCompare(String(b.chat_id)))
        .map((row) => ({ ...row })),
    };
  }

  if (normalized === "select * from protocols order by id") {
    return { results: sortByIdAsc(this.tables.protocols) };
  }

  if (normalized === "select * from sessions where chat_id = ? limit 1") {
    const [chatId] = args;
    return { results: this.tables.sessions.filter((row) => String(row.chat_id) === String(chatId)).map((row) => ({ ...row })) };
  }

  if (normalized === "delete from sessions where chat_id = ?") {
    const [chatId] = args;
    this.tables.sessions = this.tables.sessions.filter((row) => String(row.chat_id) !== String(chatId));
    return okResult();
  }

  if (normalized.startsWith("insert into sessions(chat_id, state, data, updated_at, expires_at)")) {
    const [chatId, state, data, updatedAt, expiresAt] = args;
    upsertSession(this.tables.sessions, {
      chat_id: chatId,
      state,
      data,
      updated_at: updatedAt,
      expires_at: expiresAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into settings(key, value) values (?, ?) on conflict(key) do update set value = excluded.value")) {
    const [key, value] = args;
    upsertSetting(this.tables.settings, key, value, false);
    return okResult();
  }

  if (normalized.startsWith("insert into protocols(pattern, type_name, enabled, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")) {
    const [pattern, typeName, enabled, createdBy, createdAt, updatedAt] = args;
    upsertOrReplaceProtocol(this.tables.protocols, this.autoIds, {
      pattern,
      type_name: typeName,
      enabled: Number(enabled),
      created_by: createdBy,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into channel_lists(list_type, channel_key, channel_username, channel_title, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")) {
    const [listType, channelKey, username, title, createdBy, createdAt, updatedAt] = args;
    upsertChannelList(this.tables.channel_lists, this.autoIds, {
      list_type: listType,
      channel_key: channelKey,
      channel_username: username,
      channel_title: title,
      created_by: createdBy,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into admins(") && normalized.includes("values (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
    const [chatId, displayName, ...rest] = args;
    const permissions = rest.slice(0, 8).map(Number);
    const createdAt = rest[8];
    const updatedAt = rest[9];
    upsertAdminRow(this.tables.admins, {
      chat_id: chatId,
      display_name: displayName,
      is_owner: 0,
      can_toggle_bot: permissions[0],
      can_manage_whitelist: permissions[1],
      can_manage_blacklist: permissions[2],
      can_manage_mode: permissions[3],
      can_manage_target_channel: permissions[4],
      can_manage_protocol_add: permissions[5],
      can_manage_protocol_edit: permissions[6],
      can_manage_protocol_delete: permissions[7],
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into admins(") && normalized.includes("values (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?)")) {
    const [chatId, displayName, createdAt, updatedAt] = args;
    upsertAdminRow(this.tables.admins, {
      chat_id: chatId,
      display_name: displayName,
      is_owner: 1,
      can_toggle_bot: 1,
      can_manage_whitelist: 1,
      can_manage_blacklist: 1,
      can_manage_mode: 1,
      can_manage_target_channel: 1,
      can_manage_protocol_add: 1,
      can_manage_protocol_edit: 1,
      can_manage_protocol_delete: 1,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized.startsWith("insert into admins(") && normalized.includes("values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
    const [
      chatId,
      displayName,
      isOwner,
      canToggleBot,
      canManageWhitelist,
      canManageBlacklist,
      canManageMode,
      canManageTargetChannel,
      canManageProtocolAdd,
      canManageProtocolEdit,
      canManageProtocolDelete,
      createdAt,
      updatedAt,
    ] = args;
    upsertAdminRow(this.tables.admins, {
      chat_id: chatId,
      display_name: displayName,
      is_owner: Number(isOwner),
      can_toggle_bot: Number(canToggleBot),
      can_manage_whitelist: Number(canManageWhitelist),
      can_manage_blacklist: Number(canManageBlacklist),
      can_manage_mode: Number(canManageMode),
      can_manage_target_channel: Number(canManageTargetChannel),
      can_manage_protocol_add: Number(canManageProtocolAdd),
      can_manage_protocol_edit: Number(canManageProtocolEdit),
      can_manage_protocol_delete: Number(canManageProtocolDelete),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return okResult();
  }

  if (normalized === "select * from settings") {
    return { results: this.tables.settings.map((row) => ({ ...row })) };
  }

  throw new Error(`MockD1: unsupported SQL: ${sql}`);
};

function okResult() {
  return { success: true, meta: {} };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function upsertSetting(rows, key, value, ignoreDuplicate = false) {
  const existing = rows.find((row) => row.key === key);
  if (existing) {
    if (ignoreDuplicate) {
      return;
    }
    existing.value = String(value);
    return;
  }
  rows.push({ key, value: String(value) });
}

function insertOrUpdateProtocol(rows, autoIds, row, ignoreDuplicate) {
  const existing = rows.find((entry) => entry.pattern === row.pattern);
  if (existing) {
    if (!ignoreDuplicate) {
      existing.type_name = row.type_name;
      existing.enabled = row.enabled;
      existing.created_by = row.created_by;
      existing.updated_at = row.updated_at;
    }
    return;
  }

  rows.push({
    id: autoIds.protocols++,
    ...row,
  });
}

function upsertOrReplaceProtocol(rows, autoIds, row) {
  insertOrUpdateProtocol(rows, autoIds, row, false);
}

function upsertChannelList(rows, autoIds, row) {
  const existing = rows.find(
    (entry) => entry.list_type === row.list_type && entry.channel_key === row.channel_key,
  );
  if (existing) {
    existing.channel_username = row.channel_username;
    existing.channel_title = row.channel_title;
    existing.updated_at = row.updated_at;
    return;
  }

  rows.push({
    id: autoIds.channel_lists++,
    ...row,
  });
}

function upsertAdminRow(rows, row) {
  const existing = rows.find((entry) => String(entry.chat_id) === String(row.chat_id));
  if (existing) {
    Object.assign(existing, row);
    return;
  }

  rows.push({
    ...row,
    is_owner: Number(row.is_owner || 0),
    can_toggle_bot: Number(row.can_toggle_bot || 0),
    can_manage_whitelist: Number(row.can_manage_whitelist || 0),
    can_manage_blacklist: Number(row.can_manage_blacklist || 0),
    can_manage_mode: Number(row.can_manage_mode || 0),
    can_manage_target_channel: Number(row.can_manage_target_channel || 0),
    can_manage_protocol_add: Number(row.can_manage_protocol_add || 0),
    can_manage_protocol_edit: Number(row.can_manage_protocol_edit || 0),
    can_manage_protocol_delete: Number(row.can_manage_protocol_delete || 0),
  });
}

function upsertSession(rows, row) {
  const existing = rows.find((entry) => String(entry.chat_id) === String(row.chat_id));
  if (existing) {
    Object.assign(existing, row);
    return;
  }

  rows.push({
    ...row,
    data: String(row.data),
    updated_at: row.updated_at || nowIso(),
  });
}

function sortByIdDesc(rows) {
  return [...rows].sort((a, b) => (b.id || 0) - (a.id || 0)).map((row) => ({ ...row }));
}

function sortByIdAsc(rows) {
  return [...rows].sort((a, b) => (a.id || 0) - (b.id || 0)).map((row) => ({ ...row }));
}

export function createMockEnv(overrides = {}) {
  const db = new MockD1Database();
  db.resetToDefaults();
  return {
    BOT_TOKEN: "test-token",
    WEBHOOK_SECRET: "secret",
    OWNER_CHAT_ID: "111",
    TARGET_CHANNEL_ID: "@target_channel",
    ADMIN_CHANNEL_ID: "@developer_channel",
    ADMIN_SUPPORT_DIRECT_URL: "https://t.me/vpnhub_support",
    DB: db,
    ...overrides,
  };
}

export function blankPermissionsMap() {
  return clonePermissions(PERMISSIONS);
}
