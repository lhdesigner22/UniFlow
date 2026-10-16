-- Cache do vínculo técnico↔chamado + nomes de usuário do GLPI (a parte cara
-- da sincronização) — atualizado só a cada 15 min, lido pelo backlog (que
-- sincroniza a cada 1 min) sem bater na API do GLPI. Ver server/src/lib/glpiTechCache.js.
CREATE TABLE glpi_tech_cache (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
