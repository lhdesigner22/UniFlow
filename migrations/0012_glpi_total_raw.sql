-- Cache dos chamados "crus" (sem corte de 500, todos os status) usados pelo
-- "Total de Chamados" — separado do glpi_total_snapshot (que já vem
-- pré-computado pro caso padrão "todo o período"). Existe pra permitir
-- filtrar os KPIs por um intervalo de datas sob demanda (recalculando na
-- hora, em JS puro, sem bater no GLPI de novo) — ver server/src/lib/glpiTotalSync.js
-- e server/src/routes/glpiTotal.js.
CREATE TABLE glpi_total_raw (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
