-- Mensagens rápidas por e-mail enviadas ao solicitante de um empréstimo
-- (Empréstimo de Equipamentos → ✉️). Guarda o histórico pra aparecer como um
-- "chat" na própria janela da mensagem.
CREATE TABLE IF NOT EXISTS equipment_loan_messages (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  error TEXT,
  sent_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_loan_messages_loan ON equipment_loan_messages(loan_id, created_at);
