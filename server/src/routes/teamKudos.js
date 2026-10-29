import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, canSeeDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth)

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// Feedback negativo (moon) é privado: quem recebeu e o Super Admin enxergam
// o total e o histórico das luas; os demais usuários só veem as estrelas.

// GET /members — roster com foto/nome (de `users`) e o total de
// estrelas/luas de cada um (`moons` vem null pra quem não pode ver)
app.get('/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const seesAll = await isSuperAdmin(db, user.id)
  const dept = departmentFilter(await accessOf(c), 'u.department_id')
  const members = await db.prepare(`
    SELECT tkm.id, tkm.user_id, u.name as user_name, u.avatar as user_avatar,
      (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = tkm.id AND type = 'star') as stars,
      CASE WHEN tkm.user_id = ? OR ? = 1
        THEN (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = tkm.id AND type = 'moon')
        ELSE NULL END as moons
    FROM team_kudos_members tkm JOIN users u ON u.id = tkm.user_id
    WHERE 1=1${dept.sql}
    ORDER BY u.name
  `).all(user.id, seesAll ? 1 : 0, ...dept.args)
  return c.json(members)
})

// GET /recent — mural com os últimos reconhecimentos da equipe. Só estrelas:
// a lua é privada (quem recebeu + Super Admin), então nunca entra aqui.
app.get('/recent', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'u.department_id')
  const rows = await db.prepare(`
    SELECT ev.id, ev.member_id, ev.comment, ev.created_at, u.name as user_name, u.avatar as user_avatar, tkm.user_id,
      g.name as given_by_name
    FROM team_kudos_events ev
    JOIN team_kudos_members tkm ON tkm.id = ev.member_id
    JOIN users u ON u.id = tkm.user_id
    JOIN users g ON g.id = ev.given_by
    WHERE ev.type = 'star'${dept.sql}
    ORDER BY ev.created_at DESC LIMIT 12
  `).all(...dept.args)
  return c.json(rows)
})

// GET /members/:id/events — histórico de um membro. As luas aparecem pra
// quem recebeu e pro Super Admin.
app.get('/members/:id/events', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const member = await db.prepare(`
    SELECT tkm.user_id, u.department_id FROM team_kudos_members tkm JOIN users u ON u.id = tkm.user_id WHERE tkm.id = ?
  `).get(id)
  if (!member || !canSeeDepartment(await accessOf(c), member.department_id)) return c.json([])
  const seesAll = member?.user_id === user.id || (await isSuperAdmin(db, user.id))
  const typeFilter = seesAll ? '' : "AND ev.type = 'star'"
  const events = await db.prepare(`
    SELECT ev.*, u.name as given_by_name
    FROM team_kudos_events ev JOIN users u ON u.id = ev.given_by
    WHERE ev.member_id = ? ${typeFilter} ORDER BY ev.created_at DESC LIMIT 100
  `).all(id)
  return c.json(events)
})

// POST /members — adiciona um usuário existente ao roster (super_admin)
app.post('/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { user_id } = await c.req.json()
  if (!user_id) return c.json({ error: 'user_id é obrigatório' }, 400)

  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(user_id)
  if (!target) return c.json({ error: 'Usuário não encontrado' }, 404)

  const existing = await db.prepare('SELECT id FROM team_kudos_members WHERE user_id = ?').get(user_id)
  if (existing) return c.json({ error: 'Esse colaborador já está no quadro de desempenho' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO team_kudos_members (id, user_id, added_by) VALUES (?, ?, ?)').run(id, user_id, user.id)

  const member = await db.prepare(`
    SELECT tkm.id, tkm.user_id, u.name as user_name, u.avatar as user_avatar, 0 as stars, 0 as moons
    FROM team_kudos_members tkm JOIN users u ON u.id = tkm.user_id WHERE tkm.id = ?
  `).get(id)
  return c.json(member)
})

// DELETE /members/:id — tira do roster (super_admin), apaga o histórico junto
app.delete('/members/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  await db.batch([
    { sql: 'DELETE FROM team_kudos_events WHERE member_id = ?', args: [id] },
    { sql: 'DELETE FROM team_kudos_members WHERE id = ?', args: [id] },
  ])
  return c.json({ ok: true })
})

// POST /members/:id/events — dá uma estrela ou lua (só super_admin — ver
// e navegar pelo quadro continua liberado pra qualquer usuário logado)
app.post('/members/:id/events', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const member = await db.prepare('SELECT * FROM team_kudos_members WHERE id = ?').get(id)
  if (!member) return c.json({ error: 'Colaborador não encontrado no quadro' }, 404)

  const { type, comment } = await c.req.json()
  if (!['star', 'moon'].includes(type)) return c.json({ error: 'type inválido (use star ou moon)' }, 400)

  const eventId = uuid()
  await db.prepare('INSERT INTO team_kudos_events (id, member_id, type, comment, given_by) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, id, type, comment?.trim() || null, user.id)

  const totals = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = ? AND type = 'star') as stars,
      (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = ? AND type = 'moon') as moons
  `).get(id, id)

  return c.json({ id: eventId, ...totals })
})

// DELETE /events/:id — desfaz um lançamento (só super_admin — usuário comum
// vê o histórico, mas não pode apagar nem o próprio lançamento)
app.delete('/events/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const event = await db.prepare('SELECT * FROM team_kudos_events WHERE id = ?').get(id)
  if (!event) return c.json({ error: 'Não encontrado' }, 404)
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  await db.prepare('DELETE FROM team_kudos_events WHERE id = ?').run(id)

  const totals = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = ? AND type = 'star') as stars,
      (SELECT COUNT(*) FROM team_kudos_events WHERE member_id = ? AND type = 'moon') as moons
  `).get(event.member_id, event.member_id)

  return c.json({ ok: true, member_id: event.member_id, ...totals })
})

export default app
