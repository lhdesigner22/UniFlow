import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { createNotification } from './notifications.js'
import { todayBrasilia, describeRequest, sendDecisionEmail } from '../lib/teacherPortal.js'

// Empréstimos → Pedidos de Chromebook: a TI confirma ou recusa o que os
// professores pediram no Portal do Professor. Módulo "loans" (ver: lista;
// editar: decidir). Atendimento da TI — sem separação por departamento.
const app = new Hono()
app.use('*', auth)

const DECISIONS = ['aprovada', 'recusada']

// GET /?range=upcoming|past
app.get('/', async c => {
  const db = c.get('db')
  const today = todayBrasilia()
  const past = c.req.query('range') === 'past'
  const rows = await db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email, d.name AS decided_by_name
    FROM chromebook_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users d ON d.id = r.decided_by
    WHERE ${past ? 'r.use_date < ?' : 'r.use_date >= ?'}
    ORDER BY r.use_date ${past ? 'DESC' : 'ASC'}, r.start_time ${past ? 'DESC' : 'ASC'}
    LIMIT ${past ? 100 : 300}
  `).all(today)
  return c.json({ requests: rows, today })
})

// POST /:id/decision { decision: 'aprovada'|'recusada', note }
// Dá para trocar a decisão (confirmada → recusada e vice-versa) até o dia de uso.
app.post('/:id/decision', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { decision, note } = await c.req.json().catch(() => ({}))
  if (!DECISIONS.includes(decision)) return c.json({ error: 'Decisão inválida.' }, 400)
  const cleanNote = String(note ?? '').trim().slice(0, 500) || null
  if (decision === 'recusada' && !cleanNote) return c.json({ error: 'Diga o motivo da recusa (o professor recebe por e-mail).' }, 400)

  const r = await db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM chromebook_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?
  `).get(c.req.param('id'))
  if (!r) return c.json({ error: 'Pedido não encontrado.' }, 404)
  if (r.status === 'cancelada') return c.json({ error: 'O professor cancelou este pedido.' }, 409)
  if (r.use_date < todayBrasilia()) return c.json({ error: 'Este pedido já passou.' }, 409)
  if (r.status === decision) return c.json({ ok: true, unchanged: true })

  // Trava otimista: se outra pessoa da TI decidiu ao mesmo tempo, não sobrescreve.
  const res = await db.prepare(`
    UPDATE chromebook_requests SET status = ?, decision_note = ?, decided_by = ?, decided_at = datetime('now')
    WHERE id = ? AND status = ?
  `).run(decision, cleanNote, user.id, r.id, r.status)
  if ((res?.meta?.changes ?? res?.changes) === 0) return c.json({ error: 'Outra pessoa acabou de decidir este pedido. Recarregue a lista.' }, 409)

  await createNotification(db, r.user_id, 'chromebook',
    decision === 'aprovada' ? 'Pedido de Chromebooks confirmado' : 'Pedido de Chromebooks recusado', describeRequest(r), '/professor')
  c.executionCtx.waitUntil(sendDecisionEmail(c.env, db, { to: r.requester_email, name: r.requester_name, request: r, decision, note: cleanNote }))
  return c.json({ ok: true })
})

export default app
