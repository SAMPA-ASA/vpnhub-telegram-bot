import { DEFAULT_PROTOCOLS, DEFAULT_SETTINGS, PERMISSIONS, SESSION_TTL_MINUTES } from "./constants.js";
import { boolInt, clonePermissions, normalizeChatId, nowIso } from "./utils.js";

const bootstrapPromises = new WeakMap();

export async function ensureBootstrap(env) {
  const db = env?.DB;
  if (!db || typeof db !== "object") {
    throw new Error("DB binding is required for bootstrap");
  }

  if (!bootstrapPromises.has(db)) {
    bootstrapPromises.set(db, (async () => {
      const bootstrapStatements = [
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS protocols (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL UNIQUE, type_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS channel_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, list_type TEXT NOT NULL CHECK(list_type IN ('white', 'black')), channel_key TEXT NOT NULL, channel_username TEXT, channel_title TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(list_type, channel_key));",
        "CREATE TABLE IF NOT EXISTS admins (chat_id TEXT PRIMARY KEY, display_name TEXT, is_owner INTEGER NOT NULL DEFAULT 0, can_toggle_bot INTEGER NOT NULL DEFAULT 0, can_manage_whitelist INTEGER NOT NULL DEFAULT 0, can_manage_blacklist INTEGER NOT NULL DEFAULT 0, can_manage_mode INTEGER NOT NULL DEFAULT 0, can_manage_target_channel INTEGER NOT NULL DEFAULT 0, can_manage_protocol_add INTEGER NOT NULL DEFAULT 0, can_manage_protocol_edit INTEGER NOT NULL DEFAULT 0, can_manage_protocol_delete INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS sessions (chat_id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL);",
        "CREATE INDEX IF NOT EXISTS idx_channel_lists_type_key ON channel_lists(list_type, channel_key);",
        "CREATE INDEX IF NOT EXISTS idx_protocols_enabled_pattern ON protocols(enabled, pattern);",
      ];

      for (const statement of bootstrapStatements) {
        await env.DB.exec(toSingleLineSql(statement));
      }

      const defaultSettings = Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
        env.DB.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)").bind(key, value)
      );
      await env.DB.batch(defaultSettings);

      await seedProtocols(env);
      await seedOwner(env);
    })());
  }

  return bootstrapPromises.get(db);
}

async function seedProtocols(env) {
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM protocols").first();
  if (Number(countRow?.count || 0) > 0) {
    return;
  }

  const timestamp = nowIso();
  const statements = DEFAULT_PROTOCOLS.map(([pattern, typeName]) =>
    env.DB.prepare("INSERT OR IGNORE INTO protocols(pattern, type_name, enabled, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)").bind(pattern, typeName, "system", timestamp, timestamp)
  );

  await env.DB.batch(statements);
}

async function seedOwner(env) {
  const ownerChatId = normalizeChatId(env.OWNER_CHAT_ID);
  if (!ownerChatId) {
    return;
  }

  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO admins(chat_id, display_name, is_owner, can_toggle_bot, can_manage_whitelist, can_manage_blacklist, can_manage_mode, can_manage_target_channel, can_manage_protocol_add, can_manage_protocol_edit, can_manage_protocol_delete, created_at, updated_at) VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET display_name = excluded.display_name, is_owner = 1, can_toggle_bot = 1, can_manage_whitelist = 1, can_manage_blacklist = 1, can_manage_mode = 1, can_manage_target_channel = 1, can_manage_protocol_add = 1, can_manage_protocol_edit = 1, can_manage_protocol_delete = 1, updated_at = excluded.updated_at"
  ).bind(ownerChatId, "Owner", timestamp, timestamp).run();
}

export async function getSettings(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = { ...DEFAULT_SETTINGS };

  for (const row of rows.results || []) {
    settings[row.key] = row.value;
  }

  if (!settings.target_channel_id && env.TARGET_CHANNEL_ID) {
    settings.target_channel_id = String(env.TARGET_CHANNEL_ID).trim();
  }

  return settings;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value)).run();
}

export async function getSession(env, chatId) {
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE chat_id = ? LIMIT 1")
    .bind(String(chatId))
    .first();

  if (!row) {
    return null;
  }

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await clearSession(env, chatId);
    return null;
  }

  return { ...row, data: row.data ? JSON.parse(row.data) : {} };
}

export async function setSession(env, chatId, state, data, ttlMinutes = SESSION_TTL_MINUTES) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions(chat_id, state, data, updated_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at, expires_at = excluded.expires_at").bind(String(chatId), state, JSON.stringify(data || {}), nowIso(), expiresAt).run();
}

export async function clearSession(env, chatId) {
  await env.DB.prepare("DELETE FROM sessions WHERE chat_id = ?")
    .bind(String(chatId))
    .run();
}

export async function getAdmin(chatId, env) {
  const ownerChatId = normalizeChatId(env.OWNER_CHAT_ID);
  if (ownerChatId && String(chatId) === ownerChatId) {
    return {
      chat_id: ownerChatId,
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
    };
  }

  return await env.DB.prepare("SELECT * FROM admins WHERE chat_id = ? LIMIT 1")
    .bind(String(chatId))
    .first();
}

export async function touchAdminProfile(chat, env, isOwner = false) {
  const chatId = String(chat.id);
  const displayName = [chat.first_name, chat.last_name].filter(Boolean).join(" ")
    || chat.username
    || chat.title
    || chatId;
  const timestamp = nowIso();

  if (isOwner) {
    await env.DB.prepare(
      "INSERT INTO admins(chat_id, display_name, is_owner, can_toggle_bot, can_manage_whitelist, can_manage_blacklist, can_manage_mode, can_manage_target_channel, can_manage_protocol_add, can_manage_protocol_edit, can_manage_protocol_delete, created_at, updated_at) VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET display_name = excluded.display_name, is_owner = 1, can_toggle_bot = 1, can_manage_whitelist = 1, can_manage_blacklist = 1, can_manage_mode = 1, can_manage_target_channel = 1, can_manage_protocol_add = 1, can_manage_protocol_edit = 1, can_manage_protocol_delete = 1, updated_at = excluded.updated_at"
    ).bind(chatId, displayName, timestamp, timestamp).run();
    return;
  }

  const existing = await env.DB.prepare("SELECT chat_id FROM admins WHERE chat_id = ? LIMIT 1")
    .bind(chatId)
    .first();
  if (!existing) {
    return;
  }

  await env.DB.prepare("UPDATE admins SET display_name = ?, updated_at = ? WHERE chat_id = ?")
    .bind(displayName, timestamp, chatId)
    .run();
}

export async function listAdmins(env) {
  const rows = await env.DB.prepare("SELECT * FROM admins ORDER BY is_owner DESC, updated_at DESC").all();
  return rows.results || [];
}

export async function upsertAdmin(env, chatId, permissions, displayName = null) {
  const existing = await env.DB.prepare("SELECT * FROM admins WHERE chat_id = ? LIMIT 1")
    .bind(String(chatId))
    .first();
  const timestamp = nowIso();
  const finalDisplayName = displayName || existing?.display_name || `admin:${chatId}`;

  await env.DB.prepare(
    "INSERT INTO admins(chat_id, display_name, is_owner, can_toggle_bot, can_manage_whitelist, can_manage_blacklist, can_manage_mode, can_manage_target_channel, can_manage_protocol_add, can_manage_protocol_edit, can_manage_protocol_delete, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET display_name = excluded.display_name, can_toggle_bot = excluded.can_toggle_bot, can_manage_whitelist = excluded.can_manage_whitelist, can_manage_blacklist = excluded.can_manage_blacklist, can_manage_mode = excluded.can_manage_mode, can_manage_target_channel = excluded.can_manage_target_channel, can_manage_protocol_add = excluded.can_manage_protocol_add, can_manage_protocol_edit = excluded.can_manage_protocol_edit, can_manage_protocol_delete = excluded.can_manage_protocol_delete, updated_at = excluded.updated_at"
  ).bind(
    String(chatId),
    finalDisplayName,
    boolInt(permissions.can_toggle_bot),
    boolInt(permissions.can_manage_whitelist),
    boolInt(permissions.can_manage_blacklist),
    boolInt(permissions.can_manage_mode),
    boolInt(permissions.can_manage_target_channel),
    boolInt(permissions.can_manage_protocol_add),
    boolInt(permissions.can_manage_protocol_edit),
    boolInt(permissions.can_manage_protocol_delete),
    existing?.created_at || timestamp,
    timestamp,
  ).run();
}

export async function deleteAdmin(env, chatId) {
  await env.DB.prepare("DELETE FROM admins WHERE chat_id = ?").bind(String(chatId)).run();
}

export async function listProtocols(env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM protocols ORDER BY id DESC LIMIT 200"
  ).all();
  return rows.results || [];
}

export async function getEnabledProtocols(env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM protocols WHERE enabled = 1 ORDER BY LENGTH(pattern) DESC, id ASC"
  ).all();
  return rows.results || [];
}

export async function upsertProtocol(env, createdBy, pattern, typeName) {
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO protocols(pattern, type_name, enabled, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(pattern) DO UPDATE SET type_name = excluded.type_name, enabled = 1, updated_at = excluded.updated_at"
  ).bind(pattern.toLowerCase(), typeName, createdBy, timestamp, timestamp).run();
}

export async function updateProtocolById(env, protocolId, pattern, typeName) {
  await env.DB.prepare(
    "UPDATE protocols SET pattern = ?, type_name = ?, enabled = 1, updated_at = ? WHERE id = ?"
  ).bind(pattern.toLowerCase(), typeName, nowIso(), protocolId).run();
}

export async function deleteProtocolById(env, protocolId) {
  await env.DB.prepare("DELETE FROM protocols WHERE id = ?").bind(protocolId).run();
}

export async function listChannelLists(env, listType) {
  const rows = await env.DB.prepare(
    "SELECT * FROM channel_lists WHERE list_type = ? ORDER BY id DESC LIMIT 200"
  ).bind(listType).all();
  return rows.results || [];
}

export async function upsertChannelEntry(env, createdBy, listType, reference) {
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO channel_lists(list_type, channel_key, channel_username, channel_title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(list_type, channel_key) DO UPDATE SET channel_username = excluded.channel_username, channel_title = excluded.channel_title, updated_at = excluded.updated_at"
  ).bind(
    listType,
    reference.channelKey,
    reference.channelUsername || null,
    reference.channelTitle || null,
    createdBy,
    timestamp,
    timestamp,
  ).run();
}

export async function deleteChannelEntry(env, listType, channelKey) {
  await env.DB.prepare("DELETE FROM channel_lists WHERE list_type = ? AND channel_key = ?").bind(listType, channelKey).run();
}

export async function findChannelEntry(env, listType, channelKey) {
  return await env.DB.prepare("SELECT * FROM channel_lists WHERE list_type = ? AND channel_key = ? LIMIT 1").bind(listType, channelKey).first();
}

export async function buildBackupData(env) {
  const [settings, protocols, channelLists, admins, sessions] = await Promise.all([
    env.DB.prepare("SELECT * FROM settings ORDER BY key").all(),
    env.DB.prepare("SELECT * FROM protocols ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM channel_lists ORDER BY list_type, id").all(),
    env.DB.prepare("SELECT * FROM admins ORDER BY is_owner DESC, chat_id ASC").all(),
    env.DB.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all(),
  ]);

  return {
    exported_at: nowIso(),
    settings: settings.results || [],
    protocols: protocols.results || [],
    channel_lists: channelLists.results || [],
    admins: admins.results || [],
    sessions: sessions.results || [],
  };
}

export async function restoreBackupData(env, backup) {
  const normalized = normalizeBackup(backup);
  const timestamp = nowIso();

  await env.DB.exec("DELETE FROM settings; DELETE FROM protocols; DELETE FROM channel_lists; DELETE FROM admins; DELETE FROM sessions;");

  const statements = [];

  for (const setting of normalized.settings) {
    if (setting?.key) {
      statements.push(
        env.DB.prepare("INSERT INTO settings(key, value) VALUES (?, ?)")
          .bind(String(setting.key), String(setting.value ?? ""))
      );
    }
  }

  for (const protocol of normalized.protocols) {
    if (protocol?.pattern && protocol?.type_name) {
      statements.push(
        env.DB.prepare("INSERT INTO protocols(pattern, type_name, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
          String(protocol.pattern),
          String(protocol.type_name),
          boolInt(protocol.enabled !== 0 && protocol.enabled !== "0"),
          protocol.created_by || "restore",
          protocol.created_at || timestamp,
          protocol.updated_at || timestamp,
        )
      );
    }
  }

  for (const entry of normalized.channel_lists) {
    if (entry?.list_type && entry?.channel_key) {
      statements.push(
        env.DB.prepare("INSERT INTO channel_lists(list_type, channel_key, channel_username, channel_title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
          String(entry.list_type),
          String(entry.channel_key),
          entry.channel_username || null,
          entry.channel_title || null,
          entry.created_by || "restore",
          entry.created_at || timestamp,
          entry.updated_at || timestamp,
        )
      );
    }
  }

  for (const admin of normalized.admins) {
    if (admin?.chat_id) {
      statements.push(
        env.DB.prepare("INSERT INTO admins(chat_id, display_name, is_owner, can_toggle_bot, can_manage_whitelist, can_manage_blacklist, can_manage_mode, can_manage_target_channel, can_manage_protocol_add, can_manage_protocol_edit, can_manage_protocol_delete, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
          String(admin.chat_id),
          admin.display_name || `admin:${admin.chat_id}`,
          boolInt(admin.is_owner),
          boolInt(admin.can_toggle_bot),
          boolInt(admin.can_manage_whitelist),
          boolInt(admin.can_manage_blacklist),
          boolInt(admin.can_manage_mode),
          boolInt(admin.can_manage_target_channel),
          boolInt(admin.can_manage_protocol_add),
          boolInt(admin.can_manage_protocol_edit),
          boolInt(admin.can_manage_protocol_delete),
          admin.created_at || timestamp,
          admin.updated_at || timestamp,
        )
      );
    }
  }

  await env.DB.batch(statements);
  await seedProtocols(env);
  await seedOwner(env);
}

function normalizeBackup(backup) {
  const parsed = typeof backup === "string" ? JSON.parse(backup) : (backup || {});
  return {
    settings: Array.isArray(parsed.settings) ? parsed.settings : [],
    protocols: Array.isArray(parsed.protocols) ? parsed.protocols : [],
    channel_lists: Array.isArray(parsed.channel_lists) ? parsed.channel_lists : [],
    admins: Array.isArray(parsed.admins) ? parsed.admins : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

function toSingleLineSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}
