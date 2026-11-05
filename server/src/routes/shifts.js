import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Time → Escala. O portão do worker.js já barra quem não tem o módulo `team`
// e quem só tem "ver" tentando escrever; aqui fica a separação por departamento.
const app = new Hono()
app.use('*', auth)

export const SHIFT_STATUSES = ['SEDE', 'CENTRO', 'G5', 'FOLGA', 'FERIAS']
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
// dia que existe de verdade (31/11 passa na regex, não no calendário)
const validDay = d => DAY_RE.test(d || '') && Number(d.slice(8)) <= daysInMonth(d.slice(0, 7))

const clean = (v, max) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}
const daysInMonth = month => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const monthDays = month => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)

// Pessoa visível e alterável por quem chama?
async function personFor(c, id) {
  const access = await accessOf(c)
  const row = await c.get('db').prepare('SELECT * FROM shift_people WHERE id = ?').get(id)
  if (!row || !canSeeDepartment(access, row.department_id)) return { row: null, access }
  return { row, access, canModify: canModifyDepartment(access, row.department_id, row.created_by === c.get('user').id) }
}
const notFound = c => c.json({ error: 'Pessoa não encontrada na escala' }, 404)
const forbidden = c => c.json({ error: 'Essa pessoa é de outro departamento.' }, 403)

// GET /?month=YYYY-MM — pessoas + dias marcados no mês
app.get('/', async c => {
  const db = c.get('db')
  const month = c.req.query('month')
  if (!MONTH_RE.test(month || '')) return c.json({ error: 'Mês inválido (use AAAA-MM)' }, 400)
  const dept = departmentFilter(await accessOf(c), 'p.department_id')
  const people = await db.prepare(`
    SELECT p.id, p.name, p.role_title, p.hours, p.user_id, p.department_id, p.order_index, p.active,
      u.avatar as user_avatar
    FROM shift_people p LEFT JOIN users u ON u.id = p.user_id
    WHERE 1=1${dept.sql}
    ORDER BY p.order_index, p.name
  `).all(...dept.args)
  const assignments = await db.prepare(`
    SELECT a.person_id, a.day, a.status FROM shift_assignments a
    JOIN shift_people p ON p.id = a.person_id
    WHERE a.day >= ? AND a.day <= ?${dept.sql}
  `).all(`${month}-01`, `${month}-31`, ...dept.args)
  return c.json({ month, people, assignments })
})

function personFields(body) {
  const name = clean(body.name, 120)
  if (!name) return { error: 'Informe o nome' }
  return { name, role_title: clean(body.role_title, 80), hours: clean(body.hours, 160), user_id: clean(body.user_id, 64) }
}

// POST /people
app.post('/people', async c => {
  const db = c.get('db')
  const body = await c.req.json().catch(() => ({}))
  const v = personFields(body)
  if (v.error) return c.json(v, 400)
  const id = uuid()
  const last = await db.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM shift_people').get()
  await db.prepare(`INSERT INTO shift_people (id, name, role_title, hours, user_id, department_id, order_index, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, v.name, v.role_title, v.hours, v.user_id,
    departmentForCreate(await accessOf(c), body.department_id), (last?.m ?? -1) + 1, c.get('user').id)
  return c.json(await db.prepare('SELECT * FROM shift_people WHERE id = ?').get(id))
})

// PUT /people/:id — dados, ativo/inativo
app.put('/people/:id', async c => {
  const db = c.get('db')
  const { row, access, canModify } = await personFor(c, c.req.param('id'))
  if (!row) return notFound(c)
  if (!canModify) return forbidden(c)
  const body = await c.req.json().catch(() => ({}))
  const v = personFields({ ...row, ...body })
  if (v.error) return c.json(v, 400)
  const active = body.active === undefined ? row.active : (body.active ? 1 : 0)
  await db.prepare(`UPDATE shift_people SET name = ?, role_title = ?, hours = ?, user_id = ?, active = ?, department_id = ?,
    updated_at = datetime('now') WHERE id = ?`).run(v.name, v.role_title, v.hours, v.user_id, active,
    departmentForUpdate(access, row.department_id, body.department_id), row.id)
  return c.json(await db.prepare('SELECT * FROM shift_people WHERE id = ?').get(row.id))
})

// POST /people/:id/move { dir: 'up' | 'down' } — troca de lugar com o vizinho visível
app.post('/people/:id/move', async c => {
  const db = c.get('db')
  const { row, access, canModify } = await personFor(c, c.req.param('id'))
  if (!row) return notFound(c)
  if (!canModify) return forbidden(c)
  const { dir } = await c.req.json().catch(() => ({}))
  const dept = departmentFilter(access, 'department_id')
  const list = await db.prepare(`SELECT id, order_index FROM shift_people WHERE 1=1${dept.sql} ORDER BY order_index, name`).all(...dept.args)
  const i = list.findIndex(p => p.id === row.id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) return c.json({ ok: true })
  // renumera a lista visível para não depender de order_index repetido
  const ids = list.map(p => p.id);
  [ids[i], ids[j]] = [ids[j], ids[i]]
  await db.batch(ids.map((id, k) => ({ sql: 'UPDATE shift_people SET order_index = ? WHERE id = ?', args: [k, id] })))
  return c.json({ ok: true })
})

// DELETE /people/:id — apaga a pessoa e os dias dela
app.delete('/people/:id', async c => {
  const db = c.get('db')
  const { row, canModify } = await personFor(c, c.req.param('id'))
  if (!row) return notFound(c)
  if (!canModify) return forbidden(c)
  await db.batch([
    { sql: 'DELETE FROM shift_assignments WHERE person_id = ?', args: [row.id] },
    { sql: 'DELETE FROM shift_people WHERE id = ?', args: [row.id] },
  ])
  return c.json({ ok: true })
})

// PUT /assignments { items: [{ person_id, day, status }] } — vários dias de uma vez
// (na tela, arrastar o "pincel" pinta vários dias e manda tudo junto: 1 chamada,
// 1 ida ao D1). status vazio/null limpa o dia. Até 500 por vez (15 pessoas × 31).
app.put('/assignments', async c => {
  const db = c.get('db')
  const body = await c.req.json().catch(() => ({}))
  const items = Array.isArray(body.items) ? body.items : [body]
  if (!items.length || items.length > 500) return c.json({ error: 'Envie de 1 a 500 dias' }, 400)
  for (const it of items) {
    if (!validDay(it?.day)) return c.json({ error: 'Dia inválido' }, 400)
    if (it.status && !SHIFT_STATUSES.includes(it.status)) return c.json({ error: 'Situação inválida' }, 400)
  }
  const ids = [...new Set(items.map(it => String(it.person_id || '')))]
  const rows = await db.prepare(`SELECT id, department_id, created_by FROM shift_people WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids))
  const access = await accessOf(c)
  const userId = c.get('user').id
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const id of ids) {
    const r = byId.get(id)
    if (!r || !canSeeDepartment(access, r.department_id)) return notFound(c)
    if (!canModifyDepartment(access, r.department_id, r.created_by === userId)) return forbidden(c)
  }
  await db.batch(items.map(it => it.status
    ? { sql: `INSERT INTO shift_assignments (person_id, day, status, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(person_id, day) DO UPDATE SET status = excluded.status, updated_by = excluded.updated_by, updated_at = datetime('now')`,
        args: [String(it.person_id), it.day, it.status, userId] }
    : { sql: 'DELETE FROM shift_assignments WHERE person_id = ? AND day = ?', args: [String(it.person_id), it.day] }))
  return c.json({ ok: true, saved: items.length })
})

// POST /copy { from: 'YYYY-MM', to: 'YYYY-MM' } — repete o mês anterior: cada dia
// do mês novo pega o mesmo dia da semana na mesma semana do mês de origem (1º sábado
// ← 1º sábado...). Só preenche dias VAZIOS; nada do que já foi marcado é trocado.
app.post('/copy', async c => {
  const db = c.get('db')
  const { from, to } = await c.req.json().catch(() => ({}))
  if (!MONTH_RE.test(from || '') || !MONTH_RE.test(to || '') || from === to) return c.json({ error: 'Meses inválidos' }, 400)
  const access = await accessOf(c)
  const dept = departmentFilter(access, 'p.department_id')
  const src = await db.prepare(`
    SELECT a.person_id, a.day, a.status, p.department_id, p.created_by FROM shift_assignments a
    JOIN shift_people p ON p.id = a.person_id
    WHERE p.active = 1 AND a.day >= ? AND a.day <= ?${dept.sql}
  `).all(`${from}-01`, `${from}-31`, ...dept.args)
  const existing = await db.prepare(`
    SELECT a.person_id, a.day FROM shift_assignments a JOIN shift_people p ON p.id = a.person_id
    WHERE a.day >= ? AND a.day <= ?${dept.sql}
  `).all(`${to}-01`, `${to}-31`, ...dept.args)
  const taken = new Set(existing.map(r => `${r.person_id}|${r.day}`))
  const key = d => { const dt = new Date(d + 'T12:00:00Z'); return `${dt.getUTCDay()}-${Math.floor((dt.getUTCDate() - 1) / 7)}` }
  const bySlot = new Map()
  for (const r of src) {
    if (!canModifyDepartment(access, r.department_id, r.created_by === c.get('user').id)) continue
    bySlot.set(`${r.person_id}|${key(r.day)}`, r.status)
  }
  const userId = c.get('user').id
  const stmts = []
  const people = [...new Set(src.map(r => r.person_id))]
  for (const day of monthDays(to)) {
    for (const pid of people) {
      const st = bySlot.get(`${pid}|${key(day)}`)
      if (st && !taken.has(`${pid}|${day}`)) stmts.push({ sql: 'INSERT INTO shift_assignments (person_id, day, status, updated_by) VALUES (?, ?, ?, ?)', args: [pid, day, st, userId] })
    }
  }
  // db.batch = uma ida ao D1 só (o plano grátis conta subrequests por chamada)
  if (stmts.length) await db.batch(stmts)
  return c.json({ ok: true, copied: stmts.length })
})

export default app
