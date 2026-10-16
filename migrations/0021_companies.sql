-- Filiais das empresas (Colégio SER / UniFECAF) — CNPJ, endereço e telefone
-- de cada filial. `company` é um slug fixo validado no código (server/src/
-- routes/companies.js), mesmo padrão do `location` das impressoras.
CREATE TABLE company_branches (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL, -- 'colegio-ser' | 'unifecaf'
  name TEXT,             -- nome da filial (opcional — ex: "Matriz", "Filial Centro")
  cnpj TEXT,
  address TEXT,
  phone TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
