-- Cofre de senhas — senhas de wifi, painéis administrativos etc. A senha em
-- si NUNCA é gravada em texto puro: vai criptografada (AES-GCM) com uma
-- chave que só existe como secret do Worker (VAULT_ENCRYPTION_KEY), fora do
-- banco — ver server/src/lib/vaultCrypto.js.
--
-- Acesso (ver E editar) não é por system_role — é uma lista própria que só
-- Super Admin concede/revoga pessoa por pessoa (vault_access). Super Admin
-- sempre tem acesso, mesmo sem estar nessa lista (checado em código).
CREATE TABLE vault_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  granted_by TEXT NOT NULL,
  granted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE vault_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,         -- ex: "Wi-Fi SEDE", "Painel Admin GLPI"
  category TEXT,               -- ex: wifi, admin, outro (livre)
  username TEXT,
  password_enc TEXT NOT NULL,  -- ciphertext AES-GCM, base64
  password_iv TEXT NOT NULL,   -- IV usado na criptografia, base64
  url TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_vault_access_user ON vault_access(user_id);
