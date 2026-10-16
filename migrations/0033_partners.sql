-- Empresas parceiras — cadastro simples dentro da aba Empresas, parecido
-- com internet_links (migrations/0022) mas sem local/endereço (parceiro é
-- por empresa, não por unidade/sede).
CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  responsible_name TEXT,      -- responsável da empresa parceira
  phone TEXT,
  cnpj TEXT,
  responsibility TEXT,        -- o que eles são responsáveis (descrição da parceria)
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
