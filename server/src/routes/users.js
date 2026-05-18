import { Router } from 'express'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()
router.use(auth)

// Busca usuários para adicionar em pipes
// super_admin → vê todos  |  outros → vê apenas o seu departamento
router.get('/search', (req, res) => {
  const { q, exclude } = req.query  // exclude = IDs já membros (separados por vírgula)
  if (!q || q.trim().length < 2) return res.json([])

  const requester = db.prepare(
    'SELECT system_role, department_id FROM users WHERE id = ?'
  ).get(req.user.id)

  const pattern = `%${q.trim()}%`
  const excluded = [req.user.id, ...(exclude ? exclude.split(',') : [])]
  const placeholders = excluded.map(() => '?').join(',')

  let users
  if (requester.system_role === 'super_admin') {
    users = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE (u.name LIKE ? OR u.email LIKE ?)
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(pattern, pattern, ...excluded)
  } else if (requester.department_id) {
    // Filtrado ao departamento do solicitante
    users = db.prepare(`
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
    users = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE (u.name LIKE ? OR u.email LIKE ?)
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(pattern, pattern, ...excluded)
  }

  res.json(users)
})

export default router
