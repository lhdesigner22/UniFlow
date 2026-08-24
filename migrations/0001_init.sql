-- UniFlow — schema inicial para D1
-- Consolida as CREATE TABLE + ALTER TABLE incrementais que antes rodavam
-- a cada boot em server/src/db.js (modelo Turso/local). No D1 o schema
-- vive em migrations versionadas, aplicadas uma vez via:
--   npx wrangler d1 migrations apply uniflow

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT,
  google_id TEXT,
  system_role TEXT DEFAULT 'user',
  department_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#4a7cf7',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  color TEXT DEFAULT '#4a7cf7',
  owner_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipe_members (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#4a7cf7',
  order_index INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipe_fields (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  required INTEGER DEFAULT 0,
  options TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  title TEXT NOT NULL,
  assignee_id TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'medium',
  labels TEXT DEFAULT '[]',
  order_index INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_fields (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT,
  UNIQUE(card_id, field_id)
);

CREATE TABLE IF NOT EXISTS card_comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_attachments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER,
  mime_type TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_checklist (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS card_activities (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipe_labels (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#4a7cf7'
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT DEFAULT '{}',
  action_type TEXT NOT NULL,
  action_config TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  public_token TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  read INTEGER DEFAULT 0,
  link TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Regras de encaminhamento GLOBAIS por usuário
CREATE TABLE IF NOT EXISTS user_routing_rules (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  UNIQUE(from_user_id, to_user_id)
);

-- Regras de encaminhamento: destinos individuais por pipe (legado)
CREATE TABLE IF NOT EXISTS pipe_routing_rules (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  UNIQUE(pipe_id, from_user_id, to_user_id)
);

-- Regras de encaminhamento: destinos por grupo
CREATE TABLE IF NOT EXISTS pipe_routing_groups (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  group_type TEXT NOT NULL,
  group_value TEXT NOT NULL,
  UNIQUE(pipe_id, from_user_id, group_type, group_value)
);

-- Grupos personalizados dentro do pipe
CREATE TABLE IF NOT EXISTS pipe_custom_groups (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#4a7cf7',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pipe_id, name)
);

CREATE TABLE IF NOT EXISTS pipe_custom_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE(group_id, user_id)
);
