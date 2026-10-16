import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { MODULES, MODULE_KEYS, LEVELS } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth)

// Middleware: super_admin (leitura + escrita) ou auditor (só leitura — a
// escrita de um auditor já é bloqueada antes mesmo de chegar aqui, pelo
// middleware global em worker.js; isto aqui é só pra liberar a VISÃO).
const superAdmin = async (c, next) => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role === 'super_admin') return await next()
  if (u?.system_role === 'auditor' && c.req.method === 'GET') return await next()
  return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
}
app.use('*', superAdmin)

// ─── Usuários ─────────────────────────────────────────────────────────────

app.get('/users', async c => {
  const db = c.get('db')
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.system_role, u.department_id, u.created_at,
           COALESCE(u.role_id, 'role-colaborador') AS role_id, r.name AS role_name,
           d.name as department_name, d.color as department_color
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN roles r ON r.id = COALESCE(u.role_id, 'role-colaborador')
    ORDER BY u.name
  `).all()
  return c.json(users)
})

// Cargo (role_id) e departamento da pessoa. O cargo define o `system_role`
// técnico (super_admin / auditor / user) que o resto do código checa — por isso
// os dois andam juntos: trocar o cargo atualiza o system_role.
const USER_ROW = `
  SELECT u.id, u.name, u.email, u.system_role, u.department_id,
         COALESCE(u.role_id, 'role-colaborador') AS role_id, r.name AS role_name,
         d.name as department_name, d.color as department_color
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN roles r ON r.id = COALESCE(u.role_id, 'role-colaborador')
  WHERE u.id = ?`

app.put('/users/:id', async c => {
  const db = c.get('db')
  const { system_role, role_id, department_id } = await c.req.json()
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(c.req.param('id'))
  if (!user) return c.json({ error: 'Usuário não encontrado' }, 404)

  // Compatibilidade: quem ainda manda só `system_role` cai no cargo nativo equivalente.
  let nextRoleId = role_id
  if (nextRoleId === undefined && system_role !== undefined) {
    const keepsCustom = user.role_id && user.role_id !== 'role-super-admin' && user.role_id !== 'role-auditor'
    nextRoleId = system_role === 'super_admin' ? 'role-super-admin' : system_role === 'auditor' ? 'role-auditor' : (keepsCustom ? user.role_id : 'role-analista')
  }

  let nextSystemRole = user.system_role
  if (nextRoleId !== undefined) {
    const role = await db.prepare('SELECT id, system_role FROM roles WHERE id = ?').get(nextRoleId)
    if (!role) return c.json({ error: 'Cargo não encontrado' }, 404)
    nextSystemRole = role.system_role
  }

  // Nunca deixar o sistema sem nenhum Super Admin.
  if (user.system_role === 'super_admin' && nextSystemRole !== 'super_admin') {
    const others = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE system_role = 'super_admin' AND id != ?").get(user.id)
    if (!others?.n) return c.json({ error: 'Esta é a única pessoa com cargo de Super Admin — promova outra antes.' }, 400)
  }

  await db.prepare('UPDATE users SET system_role = ?, role_id = ?, department_id = ? WHERE id = ?')
    .run(
      nextSystemRole,
      nextRoleId !== undefined ? nextRoleId : user.role_id,
      department_id !== undefined ? (department_id || null) : user.department_id,
      user.id
    )
  return c.json(await db.prepare(USER_ROW).get(user.id))
})

app.delete('/users/:id', async c => {
  const db = c.get('db')
  if (c.req.param('id') === c.get('user').id)
    return c.json({ error: 'Você não pode excluir a si mesmo.' }, 400)
  await db.prepare('DELETE FROM users WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// POST /users/:id/force-relogin — invalida o token que a pessoa já tem
// salvo (incrementa token_version), sem mexer em senha/conta Google. Na
// próxima vez que o app dela chamar GET /auth/me, cai como sessão expirada
// e ela precisa entrar de novo — útil, por ex., pra puxar a foto atual do
// Google na hora, sem esperar os 7 dias de expiração normais do token.
app.post('/users/:id/force-relogin', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!user) return c.json({ error: 'Usuário não encontrado' }, 404)
  await db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// ─── Cargos (perfis de acesso) ───────────────────────────────────────────

// Mantém só módulos/níveis válidos — cargo nunca guarda lixo.
function cleanPermissions(input) {
  const out = {}
  for (const k of MODULE_KEYS) out[k] = LEVELS.includes(input?.[k]) ? input[k] : 'none'
  return out
}

// GET /roles — cargos + quantas pessoas têm cada um + a lista de módulos (pra montar a matriz)
app.get('/roles', async c => {
  const db = c.get('db')
  const roles = await db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM users u WHERE COALESCE(u.role_id, 'role-colaborador') = r.id) AS user_count
    FROM roles r ORDER BY r.order_index, r.name
  `).all()
  return c.json({
    modules: MODULES,
    roles: roles.map(r => ({ ...r, permissions: cleanPermissions(JSON.parse(r.permissions || '{}')) })),
  })
})

// POST /roles — cria um cargo (sempre perfil técnico 'user': só os nativos são Super Admin/Auditor)
app.post('/roles', async c => {
  const db = c.get('db')
  const { name, description, scope, permissions } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'Nome do cargo é obrigatório' }, 400)
  const last = await db.prepare('SELECT MAX(order_index) AS m FROM roles').get()
  const id = uuid()
  try {
    await db.prepare(`
      INSERT INTO roles (id, name, description, system_role, scope, permissions, is_locked, order_index)
      VALUES (?, ?, ?, 'user', ?, ?, 0, ?)
    `).run(id, name.trim(), description?.trim() || null, scope === 'all' ? 'all' : 'department', JSON.stringify(cleanPermissions(permissions)), (last?.m ?? 0) + 1)
  } catch {
    return c.json({ error: 'Já existe um cargo com esse nome.' }, 409)
  }
  return c.json(await db.prepare('SELECT * FROM roles WHERE id = ?').get(id))
})

// PUT /roles/:id — Super Admin e Auditor (nativos) não mudam: o acesso deles é fixo
app.put('/roles/:id', async c => {
  const db = c.get('db')
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(c.req.param('id'))
  if (!role) return c.json({ error: 'Cargo não encontrado' }, 404)
  if (role.is_locked) return c.json({ error: 'Os cargos Super Admin e Auditor têm acesso fixo e não podem ser alterados.' }, 400)

  const { name, description, scope, permissions } = await c.req.json()
  try {
    await db.prepare('UPDATE roles SET name = ?, description = ?, scope = ?, permissions = ? WHERE id = ?').run(
      name?.trim() || role.name,
      description !== undefined ? (description?.trim() || null) : role.description,
      scope === 'all' ? 'all' : scope === 'department' ? 'department' : role.scope,
      permissions ? JSON.stringify(cleanPermissions(permissions)) : role.permissions,
      role.id
    )
  } catch {
    return c.json({ error: 'Já existe um cargo com esse nome.' }, 409)
  }
  return c.json(await db.prepare('SELECT * FROM roles WHERE id = ?').get(role.id))
})

// DELETE /roles/:id — quem tinha o cargo volta pra Colaborador (nunca fica sem cargo)
app.delete('/roles/:id', async c => {
  const db = c.get('db')
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(c.req.param('id'))
  if (!role) return c.json({ error: 'Cargo não encontrado' }, 404)
  if (role.is_locked) return c.json({ error: 'Os cargos Super Admin e Auditor não podem ser apagados.' }, 400)
  if (role.id === 'role-colaborador') return c.json({ error: 'Colaborador é o cargo padrão de quem entra — não pode ser apagado.' }, 400)
  await db.prepare("UPDATE users SET role_id = 'role-colaborador' WHERE role_id = ?").run(role.id)
  await db.prepare('DELETE FROM roles WHERE id = ?').run(role.id)
  return c.json({ ok: true })
})

// ─── Departamentos ────────────────────────────────────────────────────────

app.get('/departments', async c => {
  const db = c.get('db')
  const depts = await db.prepare(`
    SELECT d.*, COUNT(u.id) as member_count
    FROM departments d LEFT JOIN users u ON u.department_id = d.id
    GROUP BY d.id ORDER BY d.name
  `).all()
  return c.json(depts)
})

app.post('/departments', async c => {
  const db = c.get('db')
  const { name, color = '#4a7cf7', glpi_entity_name } = await c.req.json()
  if (!name) return c.json({ error: 'Nome obrigatório' }, 400)
  const id = uuid()
  try {
    await db.prepare('INSERT INTO departments (id, name, color, glpi_entity_name) VALUES (?, ?, ?, ?)').run(id, name, color, glpi_entity_name?.trim() || null)
  } catch {
    return c.json({ error: 'Já existe um departamento com esse nome.' }, 409)
  }
  return c.json(await db.prepare('SELECT * FROM departments WHERE id = ?').get(id))
})

app.put('/departments/:id', async c => {
  const db = c.get('db')
  const { name, color, glpi_entity_name } = await c.req.json()
  const dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(c.req.param('id'))
  if (!dept) return c.json({ error: 'Departamento não encontrado' }, 404)
  await db.prepare('UPDATE departments SET name = ?, color = ?, glpi_entity_name = ? WHERE id = ?')
    .run(name ?? dept.name, color ?? dept.color, glpi_entity_name !== undefined ? (glpi_entity_name?.trim() || null) : dept.glpi_entity_name, dept.id)
  return c.json(await db.prepare('SELECT * FROM departments WHERE id = ?').get(dept.id))
})

app.delete('/departments/:id', async c => {
  const db = c.get('db')
  await db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(c.req.param('id'))
  await db.prepare('DELETE FROM departments WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

export default app
