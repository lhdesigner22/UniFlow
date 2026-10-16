import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê — só super_admin cadastra (ver POST /)

const LIST_COLUMNS = `
  p.id, p.company_name, p.responsible_name, p.phone, p.cnpj, p.responsibility,
  p.created_by, p.created_at, p.updated_at, u.name as author_name,
  p.department_id, dd.name as department_name, dd.color as department_color
`

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

async function getPartnerForEdit(db, id, user, access) {
  const partner = await db.prepare('SELECT * FROM partners WHERE id = ?').get(id)
  // Registro de outro departamento é como se não existisse pra quem não o enxerga.
  if (!partner || !canSeeDepartment(access, partner.department_id)) return { partner: null, allowed: false }
  const owns = partner.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, partner.department_id, owns)
  return { partner, allowed }
}

// GET / — lista, mais recentes primeiro
app.get('/', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'p.department_id')
  return c.json(await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM partners p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id
    WHERE 1=1${dept.sql}
    ORDER BY p.company_name
  `).all(...dept.args))
})

// POST / — só super_admin cadastra
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { company_name, responsible_name, phone, cnpj, responsibility, department_id } = await c.req.json()
  if (!company_name?.trim()) return c.json({ error: 'Nome da empresa parceira é obrigatório' }, 400)

  const id = uuid()
  await db.prepare(`
    INSERT INTO partners (id, company_name, responsible_name, phone, cnpj, responsibility, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, company_name.trim(), responsible_name?.trim() || null, phone?.trim() || null,
    cnpj?.trim() || null, responsibility?.trim() || null, user.id, departmentForCreate(await accessOf(c), department_id)
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM partners p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// PUT /:id — autor ou super_admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { partner, allowed } = await getPartnerForEdit(db, id, user, await accessOf(c))
  if (!partner) return c.json({ error: 'Parceiro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { company_name, responsible_name, phone, cnpj, responsibility, department_id } = await c.req.json()

  await db.prepare(`
    UPDATE partners SET
      company_name = ?, responsible_name = ?, phone = ?, cnpj = ?, responsibility = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    company_name?.trim() || partner.company_name,
    responsible_name !== undefined ? (responsible_name?.trim() || null) : partner.responsible_name,
    phone !== undefined ? (phone?.trim() || null) : partner.phone,
    cnpj !== undefined ? (cnpj?.trim() || null) : partner.cnpj,
    responsibility !== undefined ? (responsibility?.trim() || null) : partner.responsibility,
    departmentForUpdate(await accessOf(c), partner.department_id, department_id),
    id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM partners p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// DELETE /:id — autor ou super_admin
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { partner, allowed } = await getPartnerForEdit(db, id, user, await accessOf(c))
  if (!partner) return c.json({ error: 'Parceiro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  await db.prepare('DELETE FROM partners WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app
