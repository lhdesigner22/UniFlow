-- Snapshot cacheado do "Backlog de Chamados" (contagens por status, por
-- técnico, e a lista de chamados abertos) — recalculado a cada 15 min pelo
-- mesmo cron que já sincroniza a Agenda, pra tela abrir instantânea em vez
-- de bater na API do GLPI a cada visita.
CREATE TABLE glpi_backlog_snapshot (
  id TEXT PRIMARY KEY,        -- sempre 'current'
  data TEXT NOT NULL,         -- JSON serializado (ver server/src/lib/glpiBacklogSync.js)
  updated_at TEXT DEFAULT (datetime('now'))
);
