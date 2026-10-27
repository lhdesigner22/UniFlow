import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

// Base de Conhecimento → Padronização de máquinas: configuração mínima de
// computador por cargo e as exceções por setor. Módulo "kb" (o portão do
// worker.js barra quem não vê / só vê). Institucional: sem departamento.
const app = new Hono()
app.use('*', auth)

export const KINDS = ['cargo', 'setor']
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

const COLUMNS = `
  m.id, m.kind, m.name, m.audience, m.cpu, m.ram, m.extra, m.icon, m.color, m.order_index,
  m.updated_at, u.name as updated_by_name
`
const FROM = 'FROM machine_standards m LEFT JOIN users u ON u.id = m.updated_by'

const str = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

function clean(body, current = {}) {
  const pick = (k, max) => body[k] !== undefined ? str(body[k], max) : (current[k] ?? null)
  const name = pick('name', 80)
  if (!name) return { error: 'Nome do perfil é obrigatório' }
  const kind = body.kind !== undefined ? body.kind : (current.kind || 'cargo')
  if (!KINDS.includes(kind)) return { error: 'Tipo inválido' }
  const color = pick('color', 7)
  if (color && !COLOR_RE.test(color)) return { error: 'Cor inválida' }
  return {
    name, kind, color,
    audience: pick('audience', 200),
    cpu: pick('cpu', 80),
    ram: pick('ram', 80),
    extra: pick('extra', 200),
    icon: pick('icon', 8),
  }
}

const getOne = (db, id) => db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE m.id = ?`).get(id)

app.get('/', async c => {
  return c.json(await c.get('db').prepare(`SELECT ${COLUMNS} ${FROM} ORDER BY m.kind, m.order_index, m.name`).all())
})

app.post('/', async c => {
  const db = c.get('db')
  const v = clean(await c.req.json())
  if (v.error) return c.json(v, 400)
  const id = uuid()
  const last = await db.scalar('SELECT MAX(order_index) FROM machine_standards')
  await db.prepare(`
    INSERT INTO machine_standards (id, kind, name, audience, cpu, ram, extra, icon, color, order_index, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, v.kind, v.name, v.audience, v.cpu, v.ram, v.extra, v.icon, v.color, (last ?? -1) + 1, c.get('user').id)
  return c.json(await getOne(db, id))
})

app.put('/:id', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM machine_standards WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Perfil não encontrado' }, 404)
  const v = clean(await c.req.json(), row)
  if (v.error) return c.json(v, 400)
  await db.prepare(`
    UPDATE machine_standards SET kind = ?, name = ?, audience = ?, cpu = ?, ram = ?, extra = ?, icon = ?, color = ?,
      updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.kind, v.name, v.audience, v.cpu, v.ram, v.extra, v.icon, v.color, c.get('user').id, row.id)
  return c.json(await getOne(db, row.id))
})

app.delete('/:id', async c => {
  await c.get('db').prepare('DELETE FROM machine_standards WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

export default app
