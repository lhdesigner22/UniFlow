-- Respostas por e-mail no "chat" do Empréstimo de Equipamentos.
-- O sistema já ENVIAVA mensagens (equipment_loan_messages); agora também lê a
-- caixa do Gmail que envia e traz as respostas do solicitante pro mesmo chat.
-- Ver server/src/lib/gmailInbox.js.

-- 'out' = mensagem enviada pela T.I. (o que já existia) · 'in' = resposta recebida
ALTER TABLE equipment_loan_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'out';
ALTER TABLE equipment_loan_messages ADD COLUMN from_email TEXT;
ALTER TABLE equipment_loan_messages ADD COLUMN gmail_message_id TEXT;
-- created_at da resposta = quando a pessoa enviou (data do e-mail); imported_at =
-- quando chegou ao UniFlow — é este que decide o aviso de "resposta nova"
-- (uma resposta antiga trazida agora ainda não foi vista por ninguém).
ALTER TABLE equipment_loan_messages ADD COLUMN imported_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_loan_messages_gmail ON equipment_loan_messages(gmail_message_id);

-- Fio (thread) do Gmail de cada e-mail enviado — é por ele que a resposta é
-- ligada ao empréstimo certo.
ALTER TABLE email_outbox ADD COLUMN provider_thread_id TEXT;
CREATE INDEX IF NOT EXISTS idx_email_outbox_thread ON email_outbox(provider_thread_id);

-- Quando alguém abriu o chat pela última vez (pra marcar "resposta nova" na lista).
ALTER TABLE equipment_loans ADD COLUMN replies_seen_at TEXT;

-- Mensagens da caixa já olhadas (casando ou não com um empréstimo), pra não
-- baixar a mesma de novo a cada rodada.
CREATE TABLE IF NOT EXISTS gmail_processed (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);
