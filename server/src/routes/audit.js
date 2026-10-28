import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { writeAudit, auditInBackground } from '../lib/audit.js'

// Logs de auditoria — ver lib/audit.js. Qualquer pessoa logada registra as
// telas que abre e a própria saída; LER os logs é só Super Admin e Auditor.
// Não existe rota de editar nem de apagar log.
const app = new Hono()
app.use('*', auth)

const CATEGORIES = ['vault', 'change', 'page', 'auth', 'audit']
const MAX_PAGE = 200
const MAX_EXPORT = 5000

// POST /view { path } — "abriu a tela X". Só o caminho do app (sem ?query: lá
// pode ter busca digitada); o front já evita repetir a mesma tela em seguida.
app.post('/view', async c => {
  const { path } = await c.req.json().catch(() => ({}))
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 200) return c.json({ error: 'Caminho inválido' }, 400)
  auditInBackground(c, { category: 'page', action: 'page.view', targetId: path.split('?')[0] })
  return c.json({ ok: true })
})

// POST /logout — registrado antes de o app apagar o token.
app.post('/logout', async c => {
  auditInBackground(c, { category: 'auth', action: 'auth.logout' })
  return c.json({ ok: true })
})

async function requireReader(c, next) {
  const u = await c.get('db').prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role !== 'super_admin' && u?.system_role !== 'auditor') {
    return c.json({ error: 'Só Super Admin e Auditor veem os logs.' }, 403)
  }
  await next()
}

// Monta o WHERE dos filtros: category, user_id, severity, q (texto livre), from/to (YYYY-MM-DD, horário de Brasília).
function filters(c) {
  const where = []
  const args = []
  const category = c.req.query('category')
  if (category && CATEGORIES.includes(category)) { where.push('category = ?'); args.push(category) }
  const userId = c.req.query('user_id')
  if (userId) { where.push('user_id = ?'); args.push(userId) }
  const severity = c.req.query('severity')
  if (severity === 'warning') where.push("severity IN ('warning', 'critical')")
  else if (severity === 'critical') where.push("severity = 'critical'")
  const q = (c.req.query('q') || '').trim().slice(0, 80)
  if (q) {
    where.push('(target_label LIKE ? OR path LIKE ? OR user_name LIKE ? OR user_email LIKE ? OR action LIKE ? OR ip LIKE ?)')
    const like = `%${q}%`
    args.push(like, like, like, like, like, like)
  }
  // created_at fica em UTC; Brasília = UTC−3 → o dia local começa às 03:00 UTC.
  const from = c.req.query('from')
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push("created_at >= datetime(?, '+3 hours')"); args.push(from) }
  const to = c.req.query('to')
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push("created_at < datetime(?, '+1 day', '+3 hours')"); args.push(to) }
  return { where, args }
}

const COLUMNS = `id, created_at, user_id, user_name, user_email, category, action, severity, method, path,
  status, target_id, target_label, details, ip, user_agent`

// GET / — página de logs, mais novo primeiro. Paginação por ?before=<id>.
// ?format=json&export=1 devolve até 5000 linhas pro Excel (e registra a exportação).
app.get('/', requireReader, async c => {
  const db = c.get('db')
  const { where, args } = filters(c)
  const exporting = c.req.query('export') === '1'
  const before = Number(c.req.query('before'))
  if (!exporting && before > 0) { where.push('id < ?'); args.push(before) }
  const limit = exporting ? MAX_EXPORT : Math.min(Number(c.req.query('limit')) || 100, MAX_PAGE)
  const rows = await db.prepare(`
    SELECT ${COLUMNS} FROM audit_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?
  `).all(...args, limit)
  if (exporting) {
    await writeAudit(c, { category: 'audit', action: 'audit.export', details: { rows: rows.length, filtros: c.req.query() } })
  }
  return c.json({ rows, hasMore: !exporting && rows.length === limit })
})

// GET /summary — números do topo da tela: Cofre nos últimos 7 dias + atividade de hoje.
app.get('/summary', requireReader, async c => {
  const db = c.get('db')
  const [vault, today, topUsers] = await Promise.all([
    db.prepare(`
      SELECT action, COUNT(*) as n FROM audit_logs
      WHERE category = 'vault' AND created_at >= datetime('now', '-7 days')
      GROUP BY action
    `).all(),
    db.prepare(`
      SELECT category, COUNT(*) as n FROM audit_logs
      WHERE created_at >= datetime(date('now', '-3 hours'), '+3 hours') -- meia-noite de Brasília, em UTC
      GROUP BY category
    `).all(),
    db.prepare(`
      SELECT user_id, user_name, user_email, COUNT(*) as n FROM audit_logs
      WHERE action IN ('vault.reveal', 'vault.copy', 'vlan.reveal', 'vlan.copy') AND created_at >= datetime('now', '-7 days')
      GROUP BY user_id ORDER BY n DESC LIMIT 5
    `).all(),
  ])
  const v = Object.fromEntries(vault.map(r => [r.action, r.n]))
  return c.json({
    vault7d: {
      opens: (v['vault.open'] || 0) + (v['vlan.open'] || 0),
      reveals: (v['vault.reveal'] || 0) + (v['vlan.reveal'] || 0),
      copies: (v['vault.copy'] || 0) + (v['vlan.copy'] || 0),
      changes: (v['vault.create'] || 0) + (v['vault.update'] || 0) + (v['vault.delete'] || 0),
      accessChanges: (v['vault.access_grant'] || 0) + (v['vault.access_revoke'] || 0),
      denied: v['vault.denied'] || 0,
    },
    today: Object.fromEntries(today.map(r => [r.category, r.n])),
    topRevealers: topUsers,
  })
})

// GET /people — quem aparece nos logs (filtro "Pessoa").
app.get('/people', requireReader, async c => {
  return c.json(await c.get('db').prepare(`
    SELECT user_id, MAX(user_name) as user_name, MAX(user_email) as user_email FROM audit_logs
    WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY user_name LIMIT 500
  `).all())
})

export default app
