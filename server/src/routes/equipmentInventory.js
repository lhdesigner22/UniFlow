import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Inventário de equipamentos por prédio (patrimônio conhecido, variante) —
// existe pra deixar o registro de Empréstimo de Equipamentos mais ágil: em
// vez de digitar o patrimônio de cabeça toda vez, escolhe de uma lista já
// cadastrada. Cadastro/edição/exclusão é só super_admin (evita entradas
// duplicadas/garbage no catálogo); qualquer usuário logado lê e usa pra
// escolher na hora de registrar um empréstimo.
const app = new Hono()
app.use('*', auth)

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

const LIST_COLUMNS = `
  i.id, i.building, i.equipment_model, i.variant, i.patrimony, i.notes,
  i.created_by, i.created_at, i.updated_at, i.department_id,
  CASE WHEN EXISTS (
    SELECT 1 FROM equipment_loans l
    WHERE l.equipment_inventory_id = i.id AND l.status = 'aguardando_devolucao'
  ) THEN 1 ELSE 0 END as on_loan
`

// GET /?building=sede|centro|g5 — qualquer usuário logado
app.get('/', async c => {
  const db = c.get('db')
  const building = c.req.query('building')

  let sql = `SELECT ${LIST_COLUMNS} FROM equipment_inventory i WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'i.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (building) { sql += ' AND i.building = ?'; args.push(building) }
  sql += ' ORDER BY i.equipment_model, i.variant, i.patrimony'

  return c.json(await db.prepare(sql).all(...args))
})

// POST / — só super_admin
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Sem permissão' }, 403)

  const { building, equipment_model, variant, patrimony, notes, department_id } = await c.req.json()
  if (!building?.trim()) return c.json({ error: 'Prédio é obrigatório' }, 400)
  if (!equipment_model?.trim()) return c.json({ error: 'Equipamento é obrigatório' }, 400)

  const id = uuid()
  try {
    await db.prepare(`
      INSERT INTO equipment_inventory (id, building, equipment_model, variant, patrimony, notes, created_by, department_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, building.trim(), equipment_model.trim(), variant?.trim() || null, patrimony?.trim() || null, notes?.trim() || null, user.id, departmentForCreate(await accessOf(c), department_id))
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return c.json({ error: 'Já existe um item com esse patrimônio.' }, 400)
    throw e
  }

  const row = await db.prepare(`SELECT ${LIST_COLUMNS} FROM equipment_inventory i WHERE i.id = ?`).get(id)
  return c.json(row)
})

// PUT /:id — só super_admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Sem permissão' }, 403)
  const id = c.req.param('id')

  const row = await db.prepare('SELECT * FROM equipment_inventory WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)

  const { building, equipment_model, variant, patrimony, notes, department_id } = await c.req.json()
  try {
    await db.prepare(`
      UPDATE equipment_inventory SET
        building = ?, equipment_model = ?, variant = ?, patrimony = ?, notes = ?, department_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      building?.trim() || row.building,
      equipment_model?.trim() || row.equipment_model,
      variant !== undefined ? (variant?.trim() || null) : row.variant,
      patrimony !== undefined ? (patrimony?.trim() || null) : row.patrimony,
      notes !== undefined ? (notes?.trim() || null) : row.notes,
      departmentForUpdate(await accessOf(c), row.department_id, department_id),
      id
    )
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return c.json({ error: 'Já existe um item com esse patrimônio.' }, 400)
    throw e
  }

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM equipment_inventory i WHERE i.id = ?`).get(id)
  return c.json(updated)
})

// DELETE /:id — só super_admin
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Sem permissão' }, 403)
  const id = c.req.param('id')

  await db.prepare('DELETE FROM equipment_inventory WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app
