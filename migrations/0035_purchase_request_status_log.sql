-- Histórico de mudanças de status da Solicitação de Compra — cada avanço
-- manual (Enviada ao Gestor/Comprado/Entregue) grava quem mudou e o
-- comentário opcional, pra ficar visível depois (não só a decisão dos
-- aprovadores, que já tem comment em purchase_request_approvers).
CREATE TABLE purchase_request_status_log (
  id TEXT PRIMARY KEY,
  purchase_request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  comment TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pr_status_log_request ON purchase_request_status_log(purchase_request_id);
