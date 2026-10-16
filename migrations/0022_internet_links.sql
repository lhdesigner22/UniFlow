-- Cadastro de links de internet por local (SEDE, CAMPUS CONCEITO,
-- ADMINISTRATIVO, CLINICAS) — nova sub-aba dentro do menu "Empresas".
CREATE TABLE internet_links (
  id TEXT PRIMARY KEY,
  location TEXT NOT NULL, -- 'sede' | 'campus-conceito' | 'administrativo' | 'clinicas'
  provider TEXT,          -- Nome da operadora
  speed TEXT,             -- Velocidade do link (ex: "500 Mbps", "1 Gbps")
  dual_approach INTEGER DEFAULT 0, -- Dupla abordagem (0 = Não, 1 = Sim)
  account_manager TEXT,   -- Gerente de negócios
  contact TEXT,           -- Contato (telefone/e-mail do gerente)
  cnpj TEXT,              -- CNPJ registrado no contrato
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
