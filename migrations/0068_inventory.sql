-- Inventário (grupo novo no menu). Primeiro controle: Brain (kits entregues aos
-- colaboradores — planilha "CONTROLE BRAIN"). `kind` deixa o mesmo cadastro servir
-- para outros controles depois (notebooks, celulares...). Sem departamento: é
-- patrimônio da TI. Módulo novo `inventory`.

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'brain'
  holder_name TEXT NOT NULL,          -- responsável (pessoa com o kit)
  sector TEXT,                        -- setor
  asset_tag TEXT,                     -- patrimônio
  notes TEXT,                         -- observação
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_inventory_items_kind_holder ON inventory_items(kind, holder_name);
CREATE INDEX idx_inventory_items_asset ON inventory_items(kind, asset_tag);

-- Nível do módulo novo nos cargos existentes (sem isso só o Super Admin veria)
UPDATE roles SET permissions = json_set(permissions, '$.inventory', 'edit') WHERE id IN ('role-super-admin', 'role-analista');
UPDATE roles SET permissions = json_set(permissions, '$.inventory', 'view') WHERE id IN ('role-gestor', 'role-auditor');
UPDATE roles SET permissions = json_set(permissions, '$.inventory', 'none') WHERE id NOT IN ('role-super-admin', 'role-analista', 'role-gestor', 'role-auditor');
