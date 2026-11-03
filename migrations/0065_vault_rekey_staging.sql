-- Migração de conta da Cloudflare (nov/2026): a chave antiga do Cofre não estava
-- guardada fora do Worker. A conta antiga recifra as senhas com a chave NOVA nesta
-- tabela (lib/vaultRekey.js) e a conta nova copia daqui. Apagada depois da virada.
CREATE TABLE IF NOT EXISTS vault_rekey (
  source TEXT NOT NULL,          -- 'vault' (vault_entries) | 'vlan' (vlan_ssids)
  id TEXT NOT NULL,
  enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  PRIMARY KEY (source, id)
);
