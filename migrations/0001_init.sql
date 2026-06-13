CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  type_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type TEXT NOT NULL CHECK(list_type IN ('white', 'black')),
  channel_key TEXT NOT NULL,
  channel_username TEXT,
  channel_title TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(list_type, channel_key)
);

CREATE TABLE IF NOT EXISTS admins (
  chat_id TEXT PRIMARY KEY,
  display_name TEXT,
  is_owner INTEGER NOT NULL DEFAULT 0,
  can_toggle_bot INTEGER NOT NULL DEFAULT 0,
  can_manage_whitelist INTEGER NOT NULL DEFAULT 0,
  can_manage_blacklist INTEGER NOT NULL DEFAULT 0,
  can_manage_mode INTEGER NOT NULL DEFAULT 0,
  can_manage_protocol_add INTEGER NOT NULL DEFAULT 0,
  can_manage_protocol_edit INTEGER NOT NULL DEFAULT 0,
  can_manage_protocol_delete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  chat_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_lists_type_key ON channel_lists(list_type, channel_key);
CREATE INDEX IF NOT EXISTS idx_protocols_enabled_pattern ON protocols(enabled, pattern);
