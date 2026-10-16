-- Linhas soltas no organograma — desenhadas livremente no canvas (estilo
-- Canva), sem estar presas a nenhum cargo específico. Coordenadas relativas
-- ao conteúdo rolável da árvore (mesmo espaço usado pelas posições
-- arrastadas dos cargos, ver client/src/pages/OrgChartPage.jsx).
CREATE TABLE org_chart_free_lines (
  id TEXT PRIMARY KEY,
  x1 INTEGER NOT NULL, y1 INTEGER NOT NULL,
  x2 INTEGER NOT NULL, y2 INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
