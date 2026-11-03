// Recifra as senhas do Cofre e das VLANs com uma chave NOVA, para a migração de
// conta da Cloudflare (nov/2026). Roda só no cron de 1 min, só se o secret
// VAULT_ENCRYPTION_KEY_NEW existir e só quando app_settings.vault_rekey = 'pending'
// (ligado à mão com wrangler d1 execute). Nenhuma senha sai do Worker: o
// resultado (cifrado com a chave nova) vai para a tabela vault_rekey.
// Depois da virada, apagar este arquivo, o secret e a tabela.
import { decryptSecret, encryptSecret } from './vaultCrypto.js'

export async function runVaultRekey(env, db) {
  if (!env.VAULT_ENCRYPTION_KEY_NEW) return
  const flag = await db.prepare("SELECT value FROM app_settings WHERE key = 'vault_rekey'").get()
  if (flag?.value !== 'pending') return
  const setFlag = value => db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('vault_rekey', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(value)
  try {
    const newEnv = { VAULT_ENCRYPTION_KEY: env.VAULT_ENCRYPTION_KEY_NEW }
    const [vault, vlans] = await Promise.all([
      db.prepare('SELECT id, password_enc, password_iv FROM vault_entries WHERE password_enc IS NOT NULL').all(),
      db.prepare('SELECT id, password_enc, password_iv FROM vlan_ssids WHERE password_enc IS NOT NULL').all(),
    ])
    const statements = [{ sql: 'DELETE FROM vault_rekey' }]
    for (const [source, rows] of [['vault', vault], ['vlan', vlans]]) {
      for (const r of rows) {
        const plain = await decryptSecret(env, r.password_enc, r.password_iv)
        const { ciphertext, iv } = await encryptSecret(newEnv, plain)
        // confere na hora: a chave nova decifra de volta o mesmo texto
        if (await decryptSecret(newEnv, ciphertext, iv) !== plain) throw new Error(`conferência falhou em ${source}:${r.id}`)
        statements.push({ sql: 'INSERT INTO vault_rekey (source, id, enc, iv) VALUES (?, ?, ?, ?)', args: [source, String(r.id), ciphertext, iv] })
      }
    }
    await db.batch(statements)
    await setFlag(`done:${vault.length} cofre, ${vlans.length} vlans:${new Date().toISOString()}`)
  } catch (e) {
    await setFlag(`error:${e.message}`)
  }
}
