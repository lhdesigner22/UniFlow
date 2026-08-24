-- Fase 4 — pivot de "administrador de demandas" pra quadros Kanban (estilo Trello)
-- + time tracking por card. A Fase 3 (demands) nunca foi aplicada em produção,
-- então o banco ainda tem o schema ORIGINAL da Fase 1 (pipes/cards/phases...) —
-- dropamos esse schema aqui. Os drops de `demands`/`demand_*` são defensivos
-- (IF EXISTS) só pra garantir idempotência caso alguém tenha aplicado a 0005
-- manualmente em algum ambiente.

DROP TABLE IF EXISTS pipes;
DROP TABLE IF EXISTS pipe_members;
DROP TABLE IF EXISTS phases;
DROP TABLE IF EXISTS pipe_fields;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS card_fields;
DROP TABLE IF EXISTS card_comments;
DROP TABLE IF EXISTS card_attachments;
DROP TABLE IF EXISTS card_checklist;
DROP TABLE IF EXISTS card_activities;
DROP TABLE IF EXISTS pipe_labels;
DROP TABLE IF EXISTS automations;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS user_routing_rules;
DROP TABLE IF EXISTS pipe_routing_rules;
DROP TABLE IF EXISTS pipe_routing_groups;
DROP TABLE IF EXISTS pipe_custom_groups;
DROP TABLE IF EXISTS pipe_custom_group_members;
DROP TABLE IF EXISTS card_assignees;
DROP TABLE IF EXISTS card_followers;

DROP TABLE IF EXISTS demands;
DROP TABLE IF EXISTS demand_comments;
DROP TABLE IF EXISTS demand_activities;

-- users, departments, notifications NÃO são tocadas.

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#0EA5A5',
  owner_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE board_members (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(board_id, user_id)
);

CREATE TABLE board_labels (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#0EA5A5'
);

CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT,
  order_index INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE card_members (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(card_id, user_id)
);

CREATE TABLE card_labels (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  UNIQUE(card_id, label_id)
);

CREATE TABLE card_comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE card_checklist (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE card_activities (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
