import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, canSeeDepartment } from '../lib/permissions.js'

// Jornada do colaborador — linha do tempo (marcos) + história. Qualquer
// usuário logado lê; só super_admin escreve. Quem aparece é a lista própria
// da Jornada (journey_members), escolhida pelo Super Admin.
const app = new Hono()
app.use('*', auth)

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

const deny = c => c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

// GET /members — pessoas do quadro, com quantos marcos cada uma já tem
app.get('/members', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'u.department_id')
  const rows = await db.prepare(`
    SELECT u.id as user_id, u.name as user_name, u.avatar as user_avatar,
      (SELECT COUNT(*) FROM journey_events je WHERE je.user_id = u.id) as events_count,
      (SELECT MIN(event_date) FROM journey_events je WHERE je.user_id = u.id) as first_date
    FROM journey_members jm JOIN users u ON u.id = jm.user_id
    WHERE 1=1${dept.sql}
    ORDER BY u.name
  `).all(...dept.args)
  return c.json(rows)
})

// POST /members — põe alguém na Jornada (super_admin)
app.post('/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return deny(c)
  const { user_id } = await c.req.json()
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(user_id)
  if (!target) return c.json({ error: 'Usuário não encontrado' }, 404)
  await db.prepare('INSERT OR IGNORE INTO journey_members (user_id, added_by) VALUES (?, ?)').run(user_id, user.id)
  return c.json({ ok: true })
})

// DELETE /members/:userId — tira da Jornada (super_admin). Os marcos e a
// história ficam guardados: se a pessoa voltar, volta como estava.
app.delete('/members/:userId', async c => {
  const db = c.get('db')
  if (!(await isSuperAdmin(db, c.get('user').id))) return deny(c)
  await db.prepare('DELETE FROM journey_members WHERE user_id = ?').run(c.req.param('userId'))
  return c.json({ ok: true })
})

// PUT /events/:id — editar marco (super_admin)
app.put('/events/:id', async c => {
  const db = c.get('db')
  if (!(await isSuperAdmin(db, c.get('user').id))) return deny(c)
  const id = c.req.param('id')
  const row = await db.prepare('SELECT * FROM journey_events WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Marco não encontrado' }, 404)

  const { event_date, title, description } = await c.req.json()
  await db.prepare('UPDATE journey_events SET event_date = ?, title = ?, description = ? WHERE id = ?').run(
    /^\d{4}-\d{2}-\d{2}$/.test(event_date) ? event_date : row.event_date,
    title?.trim() || row.title,
    description !== undefined ? (description?.trim() || null) : row.description,
    id
  )
  return c.json(await db.prepare('SELECT * FROM journey_events WHERE id = ?').get(id))
})

// DELETE /events/:id (super_admin)
app.delete('/events/:id', async c => {
  const db = c.get('db')
  if (!(await isSuperAdmin(db, c.get('user').id))) return deny(c)
  await db.prepare('DELETE FROM journey_events WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// GET /:userId — marcos (em ordem cronológica) + história
app.get('/:userId', async c => {
  const db = c.get('db')
  const userId = c.req.param('userId')
  const person = await db.prepare('SELECT department_id FROM users WHERE id = ?').get(userId)
  if (!person || !canSeeDepartment(await accessOf(c), person.department_id)) return c.json({ events: [], story: '', story_updated_at: null })
  const events = await db.prepare(
    'SELECT id, event_date, title, description FROM journey_events WHERE user_id = ? ORDER BY event_date, created_at'
  ).all(userId)
  const story = await db.prepare('SELECT story, updated_at FROM journey_stories WHERE user_id = ?').get(userId)
  return c.json({ events, story: story?.story || '', story_updated_at: story?.updated_at || null })
})

// POST /:userId/events — novo marco (super_admin)
app.post('/:userId/events', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return deny(c)

  const { event_date, title, description } = await c.req.json()
  if (!title?.trim()) return c.json({ error: 'Título é obrigatório' }, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date || '')) return c.json({ error: 'Data inválida' }, 400)

  const id = uuid()
  await db.prepare(
    'INSERT INTO journey_events (id, user_id, event_date, title, description, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, c.req.param('userId'), event_date, title.trim(), description?.trim() || null, user.id)
  return c.json(await db.prepare('SELECT id, event_date, title, description FROM journey_events WHERE id = ?').get(id))
})

// PUT /:userId/story — história do colaborador (super_admin)
app.put('/:userId/story', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return deny(c)

  const { story } = await c.req.json()
  await db.prepare(`
    INSERT INTO journey_stories (user_id, story, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET story = excluded.story, updated_by = excluded.updated_by, updated_at = datetime('now')
  `).run(c.req.param('userId'), (story || '').trim(), user.id)
  return c.json({ ok: true })
})

export default app
