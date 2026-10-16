import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { hasVaultAccess } from './vault.js'

// Segmentação de VLANs (Gestão). Contém as senhas de Wi-Fi, então o acesso
// segue o MESMO controle do Cofre de Senhas (Super Admin ou lista vault_access).
// A senha de cada SSID nunca vai na listagem — só sob demanda em
// GET /ssids/:id/reveal, quando a pessoa clica em "Mostrar"/"Copiar".
const app = new Hono()
app.use('*', auth)
app.use('*', async (c, next) => {
  if (!(await hasVaultAccess(c.get('db'), c.get('user').id))) {
    return c.json({ error: 'Sem acesso. Peça pra um Super Admin te autorizar (mesmo acesso do Cofre de Senhas).' }, 403)
  }
  await next()
})

const SITES = ['matriz', 'administrativo']

// GET /?site=matriz|administrativo
app.get('/', async c => {
  const db = c.get('db')
  const site = c.req.query('site')
  if (!SITES.includes(site)) return c.json({ error: 'Local inválido (use matriz ou administrativo)' }, 400)

  const networks = await db.prepare(`
    SELECT id, segment, name, vlan_id, network, mask, gateway, broadcast, dhcp_range, usable_ips
    FROM vlan_networks WHERE site = ? ORDER BY segment, order_index
  `).all(site)
  const ssids = await db.prepare(`
    SELECT id, ssid, vlan_id, note, CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END as has_password
    FROM vlan_ssids WHERE site = ? ORDER BY order_index
  `).all(site)
  return c.json({ networks, ssids })
})

// GET /ssids/:id/reveal — só a senha desse SSID
app.get('/ssids/:id/reveal', async c => {
  const row = await c.get('db').prepare('SELECT password FROM vlan_ssids WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'SSID não encontrado' }, 404)
  return c.json({ password: row.password || '' })
})

export default app
