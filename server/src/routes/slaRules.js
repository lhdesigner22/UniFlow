import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// Middleware: super_admin (leitura + escrita) ou auditor (só leitura — mesmo
// padrão inline de admin.js, não exportado lá, então replicado aqui)
const superAdmin = async (c, next) => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role === 'super_admin') return await next()
  if (u?.system_role === 'auditor' && c.req.method === 'GET') return await next()
  return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
}
app.use('*', superAdmin)

// GET / — lista todas as regras, com nome do quadro e destinatários aninhados
app.get('/', async c => {
  const db = c.get('db')
  const rules = await db.prepare(`
    SELECT sr.*, b.name as board_name
    FROM sla_rules sr LEFT JOIN boards b ON b.id = sr.board_id
    ORDER BY sr.created_at DESC
  `).all()

  for (const rule of rules) {
    rule.recipients = await db.prepare(`
      SELECT srr.*, u.name as user_name, u.email as user_email
      FROM sla_rule_recipients srr LEFT JOIN users u ON u.id = srr.user_id
      WHERE srr.rule_id = ?
    `).all(rule.id)
  }

  return c.json(rules)
})

// POST / — cria regra
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { name, board_id, threshold_hours } = await c.req.json()
  if (!name) return c.json({ error: 'Nome é obrigatório' }, 400)
  if (!threshold_hours) return c.json({ error: 'Limite em horas é obrigatório' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO sla_rules (id, board_id, name, threshold_hours, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, board_id || null, name, threshold_hours, user.id)

  return c.json(await db.prepare('SELECT * FROM sla_rules WHERE id = ?').get(id))
})

// PUT /:id
app.put('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const rule = await db.prepare('SELECT * FROM sla_rules WHERE id = ?').get(id)
  if (!rule) return c.json({ error: 'Regra não encontrada' }, 404)

  const { name, board_id, threshold_hours, active } = await c.req.json()
  await db.prepare('UPDATE sla_rules SET name = ?, board_id = ?, threshold_hours = ?, active = ? WHERE id = ?').run(
    name ?? rule.name,
    board_id !== undefined ? (board_id || null) : rule.board_id,
    threshold_hours ?? rule.threshold_hours,
    active !== undefined ? (active ? 1 : 0) : rule.active,
    id
  )

  return c.json(await db.prepare('SELECT * FROM sla_rules WHERE id = ?').get(id))
})

// DELETE /:id — cascade em recipients e alerts
app.delete('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')

  await db.batch([
    { sql: 'DELETE FROM sla_rule_recipients WHERE rule_id = ?', args: [id] },
    { sql: 'DELETE FROM sla_alerts_sent WHERE rule_id = ?', args: [id] },
    { sql: 'DELETE FROM sla_rules WHERE id = ?', args: [id] },
  ])

  return c.json({ ok: true })
})

// POST /:id/recipients — {user_id} OU {email}, exatamente um dos dois
app.post('/:id/recipients', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const rule = await db.prepare('SELECT * FROM sla_rules WHERE id = ?').get(id)
  if (!rule) return c.json({ error: 'Regra não encontrada' }, 404)

  const { user_id, email } = await c.req.json()
  if (!user_id && !email) return c.json({ error: 'Informe user_id ou email' }, 400)
  if (user_id && email) return c.json({ error: 'Informe apenas user_id OU email, não os dois' }, 400)

  const recipientId = uuid()
  await db.prepare('INSERT INTO sla_rule_recipients (id, rule_id, user_id, email) VALUES (?, ?, ?, ?)')
    .run(recipientId, id, user_id || null, email || null)

  return c.json(await db.prepare(`
    SELECT srr.*, u.name as user_name, u.email as user_email
    FROM sla_rule_recipients srr LEFT JOIN users u ON u.id = srr.user_id
    WHERE srr.id = ?
  `).get(recipientId))
})

// DELETE /:id/recipients/:recipientId
app.delete('/:id/recipients/:recipientId', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const recipientId = c.req.param('recipientId')

  await db.prepare('DELETE FROM sla_rule_recipients WHERE id = ? AND rule_id = ?').run(recipientId, id)
  return c.json({ ok: true })
})

export default app
