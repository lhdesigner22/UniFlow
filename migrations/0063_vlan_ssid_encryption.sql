-- Senhas de Wi-Fi das VLANs passam a ser guardadas cifradas (AES-GCM, mesma chave
-- e mesmo código do Cofre — lib/vaultCrypto.js). A cifragem precisa do secret
-- VAULT_ENCRYPTION_KEY, que só existe no Worker, então não dá pra fazer aqui em SQL:
-- a rota de VLANs cifra as que ainda estão em texto puro (coluna `password`) na
-- primeira vez que alguém abre a tela, e apaga o texto puro.
ALTER TABLE vlan_ssids ADD COLUMN password_enc TEXT;
ALTER TABLE vlan_ssids ADD COLUMN password_iv TEXT;
