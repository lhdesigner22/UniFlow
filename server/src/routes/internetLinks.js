import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê — só super_admin cadastra (ver POST /)

const LOCATIONS = ['sede', 'campus-conceito', 'administrativo', 'clinicas']

const LIST_COLUMNS = `
  il.id, il.location, il.provider, il.speed, il.dual_approach,
  il.account_manager, il.contact, il.cnpj, il.address, il.order_index,
  il.created_by, il.created_at, il.updated_at, u.name as author_name,
  il.department_id, dd.name as department_name, dd.color as department_color
`

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

async function getLinkForEdit(db, id, user, access) {
  const link = await db.prepare('SELECT * FROM internet_links WHERE id = ?').get(id)
  // Registro de outro departamento é como se não existisse pra quem não o enxerga.
  if (!link || !canSeeDepartment(access, link.department_id)) return { link: null, allowed: false }
  const owns = link.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, link.department_id, owns)
  return { link, allowed }
}

// GET /?location=sede|campus-conceito|administrativo|clinicas
app.get('/', async c => {
  const db = c.get('db')
  const location = c.req.query('location')

  let sql = `SELECT ${LIST_COLUMNS} FROM internet_links il LEFT JOIN users u ON u.id = il.created_by LEFT JOIN departments dd ON dd.id = il.department_id WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'il.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (location) { sql += ' AND il.location = ?'; args.push(location) }
  sql += ' ORDER BY il.location, il.order_index, il.provider'

  return c.json(await db.prepare(sql).all(...args))
})

// POST / — só super_admin cadastra
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { location, provider, speed, dual_approach, account_manager, contact, cnpj, address, department_id } = await c.req.json()
  if (!LOCATIONS.includes(location)) return c.json({ error: 'Local inválido (use sede, campus-conceito, administrativo ou clinicas)' }, 400)
  if (!provider?.trim()) return c.json({ error: 'Nome da operadora é obrigatório' }, 400)

  const maxIndex = await db.scalar('SELECT MAX(order_index) FROM internet_links WHERE location = ?', location)
  const orderIndex = (maxIndex ?? -1) + 1

  const id = uuid()
  await db.prepare(`
    INSERT INTO internet_links (id, location, provider, speed, dual_approach, account_manager, contact, cnpj, address, order_index, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, location, provider.trim(), speed?.trim() || null, dual_approach ? 1 : 0,
    account_manager?.trim() || null, contact?.trim() || null, cnpj?.trim() || null, address?.trim() || null, orderIndex, user.id, departmentForCreate(await accessOf(c), department_id)
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM internet_links il LEFT JOIN users u ON u.id = il.created_by LEFT JOIN departments dd ON dd.id = il.department_id WHERE il.id = ?`).get(id))
})

// PUT /reorder — body { ids: [id1, id2, ...] } — salva a nova ordem de
// arrastar-e-soltar dentro de um local (a lista de ids já vem filtrada por
// local pelo front-end). Só super_admin (mesma regra de criar/editar).
// Precisa vir ANTES de PUT /:id — senão o Hono trata "reorder" como um :id
// e essa rota nunca é alcançada.
app.put('/reorder', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { ids } = await c.req.json()
  if (!Array.isArray(ids)) return c.json({ error: 'ids deve ser um array' }, 400)

  await db.batch(
    ids.map((id, index) => ({
      sql: 'UPDATE internet_links SET order_index = ? WHERE id = ?',
      args: [index, id],
    }))
  )

  return c.json({ ok: true })
})

// PUT /:id — autor ou super_admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { link, allowed } = await getLinkForEdit(db, id, user, await accessOf(c))
  if (!link) return c.json({ error: 'Link não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { location, provider, speed, dual_approach, account_manager, contact, cnpj, address, department_id } = await c.req.json()
  const loc = LOCATIONS.includes(location) ? location : link.location

  await db.prepare(`
    UPDATE internet_links SET
      location = ?, provider = ?, speed = ?, dual_approach = ?,
      account_manager = ?, contact = ?, cnpj = ?, address = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    loc,
    provider?.trim() || link.provider,
    speed !== undefined ? (speed?.trim() || null) : link.speed,
    dual_approach !== undefined ? (dual_approach ? 1 : 0) : link.dual_approach,
    account_manager !== undefined ? (account_manager?.trim() || null) : link.account_manager,
    contact !== undefined ? (contact?.trim() || null) : link.contact,
    cnpj !== undefined ? (cnpj?.trim() || null) : link.cnpj,
    address !== undefined ? (address?.trim() || null) : link.address,
    departmentForUpdate(await accessOf(c), link.department_id, department_id),
    id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM internet_links il LEFT JOIN users u ON u.id = il.created_by LEFT JOIN departments dd ON dd.id = il.department_id WHERE il.id = ?`).get(id))
})

// DELETE /:id — autor ou super_admin
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { link, allowed } = await getLinkForEdit(db, id, user, await accessOf(c))
  if (!link) return c.json({ error: 'Link não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  await db.prepare('DELETE FROM internet_links WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app
