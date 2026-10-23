-- Índices pras consultas que mais liam linhas em produção (levantamento de
-- out/2026 com `wrangler d1 insights`): o banco tinha ~8,5 mil linhas, mas o
-- sistema lia ~2 milhões por dia (40% do limite diário do plano Free do D1),
-- porque estas consultas varriam a tabela inteira a cada chamada.

-- Sininho (contagem + lista): ~1,15 milhão de linhas/dia, 57% de tudo.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- Cartões de um quadro e nova posição na coluna
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id, archived);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, order_index);

-- Histórico do cartão (e o "última atividade" do SLA)
CREATE INDEX IF NOT EXISTS idx_card_activities_card ON card_activities(card_id, created_at);

-- Itens do cartão aberto
CREATE INDEX IF NOT EXISTS idx_card_checklist_card ON card_checklist(card_id, order_index);
CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_card ON time_entries(card_id);

-- Quadros que a pessoa enxerga (membro)
CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);

-- Fila de e-mails pendentes (envio a cada 15 min + Admin)
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, created_at);

-- Atualiza as estatísticas que o SQLite usa pra escolher o índice
ANALYZE;
