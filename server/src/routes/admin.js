import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// Middleware: apenas super_admin
const superAdmin = async (c, next) => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role !== 'super_admin')
    return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
  await next()
}
app.use('*', superAdmin)

// ─── Usuários ─────────────────────────────────────────────────────────────

app.get('/users', async c => {
  const db = c.get('db')
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.system_role, u.department_id, u.created_at,
           d.name as department_name, d.color as department_color
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.name
  `).all()
  return c.json(users)
})

app.put('/users/:id', async c => {
  const db = c.get('db')
  const { system_role, department_id } = await c.req.json()
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(c.req.param('id'))
  if (!user) return c.json({ error: 'Usuário não encontrado' }, 404)
  await db.prepare('UPDATE users SET system_role = ?, department_id = ? WHERE id = ?')
    .run(system_role ?? user.system_role, department_id !== undefined ? (department_id || null) : user.department_id, user.id)
  return c.json(await db.prepare(`
    SELECT u.id, u.name, u.email, u.system_role, u.department_id,
           d.name as department_name, d.color as department_color
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?
  `).get(user.id))
})

app.delete('/users/:id', async c => {
  const db = c.get('db')
  if (c.req.param('id') === c.get('user').id)
    return c.json({ error: 'Você não pode excluir a si mesmo.' }, 400)
  await db.prepare('DELETE FROM users WHERE id = ?').run(c.req.param('id'))
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
  const { name, color = '#4a7cf7' } = await c.req.json()
  if (!name) return c.json({ error: 'Nome obrigatório' }, 400)
  const id = uuid()
  try {
    await db.prepare('INSERT INTO departments (id, name, color) VALUES (?, ?, ?)').run(id, name, color)
  } catch {
    return c.json({ error: 'Já existe um departamento com esse nome.' }, 409)
  }
  return c.json(await db.prepare('SELECT * FROM departments WHERE id = ?').get(id))
})

app.put('/departments/:id', async c => {
  const db = c.get('db')
  const { name, color } = await c.req.json()
  const dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(c.req.param('id'))
  if (!dept) return c.json({ error: 'Departamento não encontrado' }, 404)
  await db.prepare('UPDATE departments SET name = ?, color = ? WHERE id = ?')
    .run(name ?? dept.name, color ?? dept.color, dept.id)
  return c.json(await db.prepare('SELECT * FROM departments WHERE id = ?').get(dept.id))
})

app.delete('/departments/:id', async c => {
  const db = c.get('db')
  await db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(c.req.param('id'))
  await db.prepare('DELETE FROM departments WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

export default app
