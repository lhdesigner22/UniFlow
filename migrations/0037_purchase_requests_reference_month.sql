-- Mês de referência da Solicitação de Compra (formato YYYY-MM) — permite
-- organizar as solicitações por mês (Setembro, Outubro...), como pedido.
-- Backfill: tudo que já existe hoje foi criado em setembro/2026, então usa
-- o mês do created_at como valor inicial.
ALTER TABLE purchase_requests ADD COLUMN reference_month TEXT;
UPDATE purchase_requests SET reference_month = strftime('%Y-%m', created_at) WHERE reference_month IS NULL;

CREATE INDEX idx_purchase_requests_reference_month ON purchase_requests(reference_month);
