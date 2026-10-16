-- Aprovador da Solicitação de Compra — mesmo modelo de approval_approvers
-- (migrations/0020_approvals.sql): quem pede escolhe 1+ aprovador(es) na
-- criação, e o item só vira "aprovado" quando todos decidirem (e "reprovado"
-- se qualquer um recusar). Depois de aprovado, o status segue livre
-- (comprado/entregue) pra qualquer usuário, como já era.
CREATE TABLE purchase_request_approvers (
  id TEXT PRIMARY KEY,
  purchase_request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  comment TEXT,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(purchase_request_id, user_id)
);

CREATE INDEX idx_pr_approvers_request ON purchase_request_approvers(purchase_request_id);
CREATE INDEX idx_pr_approvers_user ON purchase_request_approvers(user_id);
