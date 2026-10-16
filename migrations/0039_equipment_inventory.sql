-- Inventário de equipamentos por prédio (patrimônio, variante) — cadastro
-- de base pra tornar o registro de empréstimo mais ágil: em vez de digitar
-- o patrimônio de cabeça toda vez, escolhe de uma lista já conhecida.
CREATE TABLE equipment_inventory (
  id TEXT PRIMARY KEY,
  building TEXT NOT NULL,
  equipment_model TEXT NOT NULL,
  variant TEXT,
  patrimony TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_equipment_inventory_building ON equipment_inventory(building);
CREATE UNIQUE INDEX idx_equipment_inventory_patrimony ON equipment_inventory(patrimony) WHERE patrimony IS NOT NULL AND patrimony != '';
