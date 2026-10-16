-- Conexões livres entre cargos do organograma — uma linha visual entre dois
-- cargos que NÃO é relação de "reporta para" (isso continua sendo só
-- org_chart_nodes.parent_id). Serve pra agrupar visualmente cargos que se
-- relacionam sem hierarquia entre si (ex: Auxiliares e Estagiários que não
-- reportam pros Assistentes, mas fazem parte do mesmo time).
CREATE TABLE org_chart_links (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
