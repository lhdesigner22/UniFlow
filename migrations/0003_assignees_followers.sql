-- Múltiplos responsáveis (além do assignee_id "aprovador") e seguidores por card
CREATE TABLE IF NOT EXISTS card_assignees (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(card_id, user_id)
);
CREATE TABLE IF NOT EXISTS card_followers (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(card_id, user_id)
);
