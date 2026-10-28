import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { hasVaultAccess } from './vault.js'
import { writeAudit, checkRevealBurst, auditVaultDenied, auditVaultOpen } from '../lib/audit.js'
import { encryptSecret, decryptSecret } from '../lib/vaultCrypto.js'
import { rateLimit, byUser } from '../lib/rateLimit.js'

// Segmentação de VLANs (Gestão). Contém as senhas de Wi-Fi, então o acesso
// segue o MESMO controle do Cofre de Senhas (Super Admin ou lista vault_access).
// A senha de cada SSID nunca vai na listagem — só sob demanda em
// GET /ssids/:id/reveal, quando a pessoa clica em "Mostrar"/"Copiar".
// Gera log de auditoria como o Cofre (categoria 'vault'): abrir, mostrar/copiar, acesso negado.
const app = new Hono()
app.use('*', auth)
app.use('*', async (c, next) => {
  if (!(await hasVaultAccess(c.get('db'), c.get('user').id))) {
    await auditVaultDenied(c, 'a Segmentação de VLANs')
    return c.json({ error: 'Sem acesso. Peça pra um Super Admin te autorizar (mesmo acesso do Cofre de Senhas).' }, 403)
  }
  await next()
})

const SITES = ['matriz', 'administrativo']

// Senhas de Wi-Fi ficam cifradas como as do Cofre (password_enc/password_iv).
// As que ainda estão em texto puro (antes da migração 0063, ou vindas de um seed)
// são cifradas aqui e o texto puro é apagado — roda ao abrir a tela.
async function encryptPlainPasswords(c) {
  const db = c.get('db')
  const plain = await db.prepare("SELECT id, password FROM vlan_ssids WHERE password IS NOT NULL AND password != ''").all()
  if (!plain.length) return
  const updates = []
  for (const row of plain) {
    const { ciphertext, iv } = await encryptSecret(c.env, row.password)
    updates.push({ sql: 'UPDATE vlan_ssids SET password_enc = ?, password_iv = ?, password = NULL WHERE id = ?', args: [ciphertext, iv, row.id] })
  }
  await db.batch(updates)
}

// GET /?site=matriz|administrativo
app.get('/', async c => {
  const db = c.get('db')
  const site = c.req.query('site')
  if (!SITES.includes(site)) return c.json({ error: 'Local inválido (use matriz ou administrativo)' }, 400)

  await encryptPlainPasswords(c)
  const networks = await db.prepare(`
    SELECT id, segment, name, vlan_id, network, mask, gateway, broadcast, dhcp_range, usable_ips
    FROM vlan_networks WHERE site = ? ORDER BY segment, order_index
  `).all(site)
  const ssids = await db.prepare(`
    SELECT id, ssid, vlan_id, note, CASE WHEN password_enc IS NOT NULL THEN 1 ELSE 0 END as has_password
    FROM vlan_ssids WHERE site = ? ORDER BY order_index
  `).all(site)
  await auditVaultOpen(c, 'vlan.open', `VLANs — ${site}`)
  return c.json({ networks, ssids })
})

// GET /ssids/:id/reveal — só a senha desse SSID
app.get('/ssids/:id/reveal', rateLimit('SECRET_LIMITER', byUser, 'Muitas senhas em pouco tempo — espere um minuto.'), async c => {
  const id = c.req.param('id')
  await encryptPlainPasswords(c)
  const row = await c.get('db').prepare('SELECT ssid, site, password_enc, password_iv FROM vlan_ssids WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'SSID não encontrado' }, 404)
  const action = c.req.query('purpose') === 'copy' ? 'vlan.copy' : 'vlan.reveal'
  // Log gravado ANTES de decifrar (como no Cofre): sem log, sem senha.
  await writeAudit(c, { category: 'vault', action, severity: 'warning', status: 200, targetId: id, targetLabel: `Wi-Fi ${row.ssid} (${row.site})` })
  await checkRevealBurst(c)
  const password = row.password_enc ? await decryptSecret(c.env, row.password_enc, row.password_iv) : ''
  return c.json({ password })
})

export default app
