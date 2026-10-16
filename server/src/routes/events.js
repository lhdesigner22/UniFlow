import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { expandEventsInRange } from '../lib/schedule.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado gerencia eventos (sem superAdmin)

// GET /?from=&to= — ocorrências já expandidas (inclui recorrências) no intervalo
app.get('/', async c => {
  const db = c.get('db')
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'Parâmetros from e to (YYYY-MM-DD) são obrigatórios' }, 400)

  // Só os eventos do departamento da pessoa (+ os "Geral"); escopo "todos" vê tudo.
  const access = await accessOf(c)
  const occurrences = await expandEventsInRange(db, from, to, departmentFilter(access))
  return c.json(occurrences)
})

// POST / — cria evento (definição bruta, recorrente ou não)
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { title, description, board_id, event_date, event_time, recurrence_type, recurrence_until, department_id } = await c.req.json()

  if (!title) return c.json({ error: 'Título é obrigatório' }, 400)
  if (!event_date) return c.json({ error: 'Data do evento é obrigatória' }, 400)
  const access = await accessOf(c)

  const id = uuid()
  await db.prepare(`
    INSERT INTO events (id, board_id, title, description, event_date, event_time, recurrence_type, recurrence_until, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, board_id || null, title, description || null, event_date, event_time || null, recurrence_type || 'none', recurrence_until || null, user.id, departmentForCreate(access, department_id))

  return c.json(await db.prepare('SELECT * FROM events WHERE id = ?').get(id))
})

// PUT /:id — só o criador ou super_admin (mesmo idioma de boards.js)
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').get(id)
  const access = await accessOf(c)
  // Evento de outro departamento é como se não existisse pra quem não o enxerga.
  if (!ev || !canSeeDepartment(access, ev.department_id)) return c.json({ error: 'Evento não encontrado' }, 404)

  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(user.id)
  if (ev.created_by !== user.id && u?.system_role !== 'super_admin')
    return c.json({ error: 'Sem permissão' }, 403)
  if (!canModifyDepartment(access, ev.department_id, ev.created_by === user.id))
    return c.json({ error: 'Este evento é de outro departamento (ou geral) e só quem enxerga todos os departamentos altera.' }, 403)

  const { title, description, board_id, event_date, event_time, recurrence_type, recurrence_until, department_id } = await c.req.json()
  await db.prepare(`
    UPDATE events SET title = ?, description = ?, board_id = ?, event_date = ?, event_time = ?, recurrence_type = ?, recurrence_until = ?, department_id = ?
    WHERE id = ?
  `).run(
    title ?? ev.title,
    description !== undefined ? description : ev.description,
    board_id !== undefined ? (board_id || null) : ev.board_id,
    event_date ?? ev.event_date,
    event_time !== undefined ? event_time : ev.event_time,
    recurrence_type ?? ev.recurrence_type,
    recurrence_until !== undefined ? recurrence_until : ev.recurrence_until,
    departmentForUpdate(access, ev.department_id, department_id),
    id
  )

  return c.json(await db.prepare('SELECT * FROM events WHERE id = ?').get(id))
})

// DELETE /:id — mesma checagem de permissão do PUT
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').get(id)
  const access = await accessOf(c)
  if (!ev || !canSeeDepartment(access, ev.department_id)) return c.json({ error: 'Evento não encontrado' }, 404)

  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(user.id)
  if (ev.created_by !== user.id && u?.system_role !== 'super_admin')
    return c.json({ error: 'Sem permissão' }, 403)
  if (!canModifyDepartment(access, ev.department_id, ev.created_by === user.id))
    return c.json({ error: 'Este evento é de outro departamento (ou geral) e só quem enxerga todos os departamentos apaga.' }, 403)

  await db.prepare('DELETE FROM events WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app
