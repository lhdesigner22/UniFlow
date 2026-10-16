import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê — só super_admin cadastra (ver POST /)

const COMPANIES = ['colegio-ser', 'unifecaf']

const LIST_COLUMNS = `
  cb.id, cb.company, cb.name, cb.cnpj, cb.address, cb.phone,
  cb.created_by, cb.created_at, cb.updated_at, u.name as author_name,
  cb.department_id, dd.name as department_name, dd.color as department_color
`

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

async function getBranchForEdit(db, id, user, access) {
  const branch = await db.prepare('SELECT * FROM company_branches WHERE id = ?').get(id)
  // Registro de outro departamento é como se não existisse pra quem não o enxerga.
  if (!branch || !canSeeDepartment(access, branch.department_id)) return { branch: null, allowed: false }
  const owns = branch.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, branch.department_id, owns)
  return { branch, allowed }
}

// GET /?company=colegio-ser|unifecaf — lista, mais recentes primeiro
app.get('/', async c => {
  const db = c.get('db')
  const company = c.req.query('company')

  let sql = `SELECT ${LIST_COLUMNS} FROM company_branches cb LEFT JOIN users u ON u.id = cb.created_by LEFT JOIN departments dd ON dd.id = cb.department_id WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'cb.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (company) { sql += ' AND cb.company = ?'; args.push(company) }
  sql += ' ORDER BY cb.name'

  return c.json(await db.prepare(sql).all(...args))
})

// POST / — só super_admin cadastra
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { company, name, cnpj, address, phone, department_id } = await c.req.json()
  if (!COMPANIES.includes(company)) return c.json({ error: 'Empresa inválida (use colegio-ser ou unifecaf)' }, 400)
  if (!name?.trim() && !cnpj?.trim()) return c.json({ error: 'Informe ao menos o nome da filial ou o CNPJ' }, 400)

  const id = uuid()
  await db.prepare(`
    INSERT INTO company_branches (id, company, name, cnpj, address, phone, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company, name?.trim() || null, cnpj?.trim() || null, address?.trim() || null, phone?.trim() || null, user.id, departmentForCreate(await accessOf(c), department_id))

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM company_branches cb LEFT JOIN users u ON u.id = cb.created_by LEFT JOIN departments dd ON dd.id = cb.department_id WHERE cb.id = ?`).get(id))
})

// PUT /:id — autor ou super_admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { branch, allowed } = await getBranchForEdit(db, id, user, await accessOf(c))
  if (!branch) return c.json({ error: 'Filial não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { company, name, cnpj, address, phone, department_id } = await c.req.json()
  const comp = COMPANIES.includes(company) ? company : branch.company

  await db.prepare(`
    UPDATE company_branches SET company = ?, name = ?, cnpj = ?, address = ?, phone = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    comp,
    name !== undefined ? (name?.trim() || null) : branch.name,
    cnpj !== undefined ? (cnpj?.trim() || null) : branch.cnpj,
    address !== undefined ? (address?.trim() || null) : branch.address,
    phone !== undefined ? (phone?.trim() || null) : branch.phone,
    departmentForUpdate(await accessOf(c), branch.department_id, department_id),
    id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM company_branches cb LEFT JOIN users u ON u.id = cb.created_by LEFT JOIN departments dd ON dd.id = cb.department_id WHERE cb.id = ?`).get(id))
})

// DELETE /:id — autor ou super_admin
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { branch, allowed } = await getBranchForEdit(db, id, user, await accessOf(c))
  if (!branch) return c.json({ error: 'Filial não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  await db.prepare('DELETE FROM company_branches WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app
