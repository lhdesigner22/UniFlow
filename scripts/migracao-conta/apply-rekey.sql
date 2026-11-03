-- Rodar na conta NOVA depois de importar o backup (wrangler d1 execute uniflow --remote --file=...).
-- Troca as senhas do Cofre/VLANs pelas recifradas com a chave nova (lib/vaultRekey.js) e apaga a tabela temporária.
UPDATE vault_entries SET
  password_enc = (SELECT enc FROM vault_rekey k WHERE k.source = 'vault' AND k.id = CAST(vault_entries.id AS TEXT)),
  password_iv  = (SELECT iv  FROM vault_rekey k WHERE k.source = 'vault' AND k.id = CAST(vault_entries.id AS TEXT))
WHERE CAST(id AS TEXT) IN (SELECT id FROM vault_rekey WHERE source = 'vault');
UPDATE vlan_ssids SET
  password_enc = (SELECT enc FROM vault_rekey k WHERE k.source = 'vlan' AND k.id = CAST(vlan_ssids.id AS TEXT)),
  password_iv  = (SELECT iv  FROM vault_rekey k WHERE k.source = 'vlan' AND k.id = CAST(vlan_ssids.id AS TEXT))
WHERE CAST(id AS TEXT) IN (SELECT id FROM vault_rekey WHERE source = 'vlan');
DROP TABLE vault_rekey;
