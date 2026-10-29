-- Time → Desempenho: a tabela de reconhecimentos não tinha índice. Os totais
-- por pessoa (COUNT por member_id + type) e o mural "últimos reconhecimentos"
-- (type = 'star' ORDER BY created_at DESC) passam a usar índice.
CREATE INDEX IF NOT EXISTS idx_team_kudos_events_member_type ON team_kudos_events(member_id, type);
CREATE INDEX IF NOT EXISTS idx_team_kudos_events_type_created ON team_kudos_events(type, created_at);
