-- Cache do snapshot "Total de Chamados" (todos os status, não só backlog em
-- aberto) — mesmo padrão de glpi_backlog_snapshot (migrations/0009).
CREATE TABLE glpi_total_snapshot (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
