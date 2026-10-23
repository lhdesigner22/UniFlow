-- Impressoras → Estoque de insumos: toner, cilindro, tinta, cartucho, fusor...
-- com saldo POR PRÉDIO (mesmos locais das impressoras) e o histórico de cada
-- entrada, troca na impressora, transferência e ajuste de contagem.
-- Ver server/src/routes/printerSupplies.js. Volume esperado: dezenas de itens e
-- ~50 movimentações/mês — o saldo fica guardado em printer_supply_stock (não é
-- recalculado somando o histórico a cada leitura).

-- Catálogo: um item por insumo ("Toner Ricoh SP 377 preto")
CREATE TABLE IF NOT EXISTS printer_supplies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,                       -- código/part number do fabricante (ex: 408161)
  type TEXT NOT NULL,              -- toner | cilindro | tinta | cartucho | fusor | residuo | kit | outro
  color TEXT,                      -- preto | ciano | magenta | amarelo | (vazio = não se aplica)
  models TEXT NOT NULL DEFAULT '[]', -- JSON: modelos de impressora compatíveis (como em printers.model)
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, -- 0 = item descontinuado (some da lista, histórico fica)
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Saldo e mínimo de cada insumo em cada prédio
CREATE TABLE IF NOT EXISTS printer_supply_stock (
  supply_id TEXT NOT NULL,
  location TEXT NOT NULL,          -- sede | adm | centro | g5 | clinicas
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0, -- abaixo/igual disso = alerta de reposição
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (supply_id, location)
);
CREATE INDEX IF NOT EXISTS idx_supply_stock_location ON printer_supply_stock(location);

-- Histórico. `delta` = quanto o saldo daquele prédio mudou (+ entrada, − saída).
CREATE TABLE IF NOT EXISTS printer_supply_movements (
  id TEXT PRIMARY KEY,
  supply_id TEXT NOT NULL,
  location TEXT NOT NULL,
  kind TEXT NOT NULL,              -- entrada | troca | transferencia_saida | transferencia_entrada | ajuste
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,  -- saldo do prédio depois do movimento
  printer_id TEXT,                 -- troca: em qual impressora foi instalado
  related_location TEXT,           -- transferência: o outro prédio
  happened_at TEXT NOT NULL,       -- quando aconteceu (horário de Brasília, 'YYYY-MM-DDTHH:MM')
  note TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supply_mov_supply ON printer_supply_movements(supply_id, location, happened_at);
CREATE INDEX IF NOT EXISTS idx_supply_mov_printer ON printer_supply_movements(printer_id, happened_at);
