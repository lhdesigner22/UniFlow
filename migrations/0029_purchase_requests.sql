-- Solicitação de Compra — tabela tipo planilha (item, chamado, departamento,
-- quantidade, valores, link, observação, status) pra substituir a planilha
-- de compras usada hoje. valor_total não é guardado — é sempre
-- quantity * unit_price, calculado na hora (server e client).
CREATE TABLE purchase_requests (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  ticket_number TEXT,
  department TEXT,
  description TEXT,
  location TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  link_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | aprovado | comprado | entregue
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_purchase_requests_created_by ON purchase_requests(created_by);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
