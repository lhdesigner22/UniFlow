import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()
router.use(auth)

// Middleware: apenas super_admin
const superAdmin = (req, res, next) => {
  const u = db.prepare('SELECT system_role FROM users WHERE id = ?').get(req.user.id)
  if (u?.system_role !== 'super_admin')
    return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' })
  next()
}
router.use(superAdmin)

// ─── Pipes (visão geral para o admin) ─────────────────────────────────────

router.get('/pipes', (req, res) => {
  const pipes = db.prepare(`
    SELECT p.id, p.name, p.icon, p.color, p.owner_id,
           u.name as owner_name,
           COUNT(DISTINCT pm.id) as member_count
    FROM pipes p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN pipe_members pm ON pm.pipe_id = p.id
    GROUP BY p.id ORDER BY p.name
  `).all()
  res.json(pipes)
})

// ─── Regras de Encaminhamento Globais ─────────────────────────────────────
// Configuração por usuário: "usuário X pode encaminhar somente para estes usuários"
// Sem regra = sem restrição (pode encaminhar para qualquer membro do pipe)

// GET /admin/routing — lista todos os usuários com suas regras configuradas
router.get('/routing', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.system_role,
           d.name as department_name, d.color as department_color
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.name
  `).all()

  const rules = db.prepare(`
    SELECT r.id, r.from_user_id, r.to_user_id,
           t.name as to_name, t.email as to_email, t.avatar as to_avatar
    FROM user_routing_rules r
    JOIN users t ON t.id = r.to_user_id
    ORDER BY t.name
  `).all()

  // Agrupa as regras por from_user_id
  const rulesByUser = {}
  rules.forEach(r => {
    if (!rulesByUser[r.from_user_id]) rulesByUser[r.from_user_id] = []
    rulesByUser[r.from_user_id].push(r)
  })

  const result = users.map(u => ({
    ...u,
    routing_targets: rulesByUser[u.id] || [],
  }))

  res.json(result)
})

// POST /admin/routing — adiciona uma regra
router.post('/routing', (req, res) => {
  const { from_user_id, to_user_id } = req.body
  if (!from_user_id || !to_user_id)
    return res.status(400).json({ error: 'from_user_id e to_user_id são obrigatórios.' })
  if (from_user_id === to_user_id)
    return res.status(400).json({ error: 'Origem e destino não podem ser o mesmo usuário.' })

  const fromUser = db.prepare('SELECT id, name FROM users WHERE id = ?').get(from_user_id)
  const toUser   = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(to_user_id)
  if (!fromUser) return res.status(404).json({ error: 'Usuário de origem não encontrado.' })
  if (!toUser)   return res.status(404).json({ error: 'Usuário de destino não encontrado.' })

  const id = uuid()
  try {
    db.prepare('INSERT INTO user_routing_rules (id, from_user_id, to_user_id) VALUES (?, ?, ?)')
      .run(id, from_user_id, to_user_id)
  } catch {
    return res.status(409).json({ error: 'Esta regra já existe.' })
  }

  res.json({ id, from_user_id, to_user_id, to_name: toUser.name, to_email: toUser.email, to_avatar: toUser.avatar })
})

// DELETE /admin/routing/:id — remove uma regra
router.delete('/routing/:id', (req, res) => {
  db.prepare('DELETE FROM user_routing_rules WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// DELETE /admin/routing/user/:userId — limpa TODAS as regras de um usuário
router.delete('/routing/user/:userId', (req, res) => {
  db.prepare('DELETE FROM user_routing_rules WHERE from_user_id = ?').run(req.params.userId)
  res.json({ ok: true })
})

// ─── Usuários ─────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.system_role, u.department_id, u.created_at,
           d.name as department_name, d.color as department_color
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.name
  `).all()
  res.json(users)
})

router.put('/users/:id', (req, res) => {
  const { system_role, department_id } = req.body
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })
  db.prepare('UPDATE users SET system_role = ?, department_id = ? WHERE id = ?')
    .run(system_role ?? user.system_role, department_id !== undefined ? (department_id || null) : user.department_id, user.id)
  res.json(db.prepare(`
    SELECT u.id, u.name, u.email, u.system_role, u.department_id,
           d.name as department_name, d.color as department_color
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?
  `).get(user.id))
})

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' })
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ─── Departamentos ────────────────────────────────────────────────────────

router.get('/departments', (req, res) => {
  const depts = db.prepare(`
    SELECT d.*, COUNT(u.id) as member_count
    FROM departments d LEFT JOIN users u ON u.department_id = d.id
    GROUP BY d.id ORDER BY d.name
  `).all()
  res.json(depts)
})

router.post('/departments', (req, res) => {
  const { name, color = '#4a7cf7' } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' })
  const id = uuid()
  try {
    db.prepare('INSERT INTO departments (id, name, color) VALUES (?, ?, ?)').run(id, name, color)
  } catch {
    return res.status(409).json({ error: 'Já existe um departamento com esse nome.' })
  }
  res.json(db.prepare('SELECT * FROM departments WHERE id = ?').get(id))
})

router.put('/departments/:id', (req, res) => {
  const { name, color } = req.body
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id)
  if (!dept) return res.status(404).json({ error: 'Departamento não encontrado' })
  db.prepare('UPDATE departments SET name = ?, color = ? WHERE id = ?')
    .run(name ?? dept.name, color ?? dept.color, dept.id)
  res.json(db.prepare('SELECT * FROM departments WHERE id = ?').get(dept.id))
})

router.delete('/departments/:id', (req, res) => {
  db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(req.params.id)
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
