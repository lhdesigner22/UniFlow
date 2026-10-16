-- Deslocamento manual (arrastar-e-soltar) de um cargo em relação à posição
-- automática da árvore — permite reorganizar visualmente sem mexer na
-- hierarquia (parent_id continua sendo a fonte de verdade de "reporta para").
ALTER TABLE org_chart_nodes ADD COLUMN offset_x INTEGER DEFAULT 0;
ALTER TABLE org_chart_nodes ADD COLUMN offset_y INTEGER DEFAULT 0;
