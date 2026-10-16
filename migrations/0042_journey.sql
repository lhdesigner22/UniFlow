-- Jornada do colaborador (aba Time > Jornada): marcos da linha do tempo dentro
-- da empresa + a história dele em texto. Quem aparece é o mesmo quadro de
-- pessoas do Desempenho (team_kudos_members). Qualquer usuário logado lê;
-- só Super Admin cria/edita/exclui.
CREATE TABLE journey_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_date TEXT NOT NULL,        -- YYYY-MM-DD
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_journey_events_user ON journey_events(user_id, event_date);

CREATE TABLE journey_stories (
  user_id TEXT PRIMARY KEY,
  story TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
