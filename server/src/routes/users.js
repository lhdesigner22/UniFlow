import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// Busca usuários para adicionar em pipes
// super_admin → vê todos  |  outros → vê apenas o seu departamento
app.get('/search', async c => {
  const db = c.get('db')
  const q = c.req.query('q')
  const exclude = c.req.query('exclude')  // exclude = IDs já membros (separados por vírgula)
  if (!q || q.trim().length < 2) return c.json([])

  const requester = await db.prepare(
    'SELECT system_role, department_id FROM users WHERE id = ?'
  ).get(c.get('user').id)

  const pattern = `%${q.trim()}%`
  const excluded = [c.get('user').id, ...(exclude ? exclude.split(',') : [])]
  const placeholders = excluded.map(() => '?').join(',')

  let users
  if (requester.system_role === 'super_admin') {
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE (u.name LIKE ? OR u.email LIKE ?)
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(pattern, pattern, ...excluded)
  } else if (requester.department_id) {
    // Filtrado ao departamento do solicitante
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE (u.name LIKE ? OR u.email LIKE ?)
        AND u.department_id = ?
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(pattern, pattern, requester.department_id, ...excluded)
  } else {
    // Sem departamento configurado: mostra todos (sistema ainda não estruturado)
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE (u.name LIKE ? OR u.email LIKE ?)
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(pattern, pattern, ...excluded)
  }

  return c.json(users)
})

export default app
