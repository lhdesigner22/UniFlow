-- Aprovações estilo "Approvals" do Microsoft Teams: um pedido com um ou mais
-- aprovadores; cada aprovador decide individualmente (aprovado/reprovado +
-- comentário opcional). O status geral do pedido é derivado das decisões
-- (ver server/src/routes/approvals.js, função computeStatus): reprovado se
-- QUALQUER aprovador reprovar, aprovado só se TODOS aprovarem, senão pendente.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  due_date TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_file_id TEXT, -- Google Drive — mesmo padrão de kb/printers (server/src/lib/driveClient.js)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE approval_approvers (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  comment TEXT,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(approval_id, user_id)
);

CREATE INDEX idx_approval_approvers_approval ON approval_approvers(approval_id);
CREATE INDEX idx_approval_approvers_user ON approval_approvers(user_id);
CREATE INDEX idx_approvals_requested_by ON approvals(requested_by);
