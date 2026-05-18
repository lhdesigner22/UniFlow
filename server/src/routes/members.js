import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

// Verifica se o usuário pode encaminhar/adicionar outro usuário
function checkRoutingAllowed(fromUserId, toUserId) {
  if (!toUserId) return null
  const globalRules = db.prepare(
    'SELECT to_user_id FROM user_routing_rules WHERE from_user_id = ?'
  ).all(fromUserId)
  if (globalRules.length === 0) return null
  const allowed = globalRules.some(r => r.to_user_id === toUserId)
  if (!allowed) {
    const dest = db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId)
    return `Você não tem permissão para adicionar ${dest?.name ?? 'este usuário'} ao pipe.`
  }
  return null
}

// Helper: verifica se o usuário é admin do pipe (super_admin do sistema tem acesso irrestrito)
function isPipeAdmin(pipeId, userId) {
  const u = db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  if (u?.system_role === 'super_admin') return true
  const pipe = db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(pipeId)
  if (pipe?.owner_id === userId) return true
  const member = db.prepare('SELECT role FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(pipeId, userId)
  return member?.role === 'admin'
}

// ─── Membros ──────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const members = db.prepare(`
    SELECT pm.id as member_id, pm.role, u.id, u.name, u.email, u.avatar
    FROM pipe_members pm JOIN users u ON u.id = pm.user_id
    WHERE pm.pipe_id = ?
  `).all(req.params.pipeId)
  res.json(members)
})

router.post('/', (req, res) => {
  const { email, role = 'member' } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })

  // Valida regra de encaminhamento global
  const routingError = checkRoutingAllowed(req.user.id, user.id)
  if (routingError) return res.status(403).json({ error: routingError })

  const exists = db.prepare('SELECT id FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(req.params.pipeId, user.id)
  if (exists) return res.status(409).json({ error: 'Já é membro' })
  const id = uuid()
  db.prepare('INSERT INTO pipe_members (id, pipe_id, user_id, role) VALUES (?, ?, ?, ?)').run(id, req.params.pipeId, user.id, role)
  res.json({ id, user, role })
})

router.put('/:memberId', (req, res) => {
  const { role } = req.body
  db.prepare('UPDATE pipe_members SET role = ? WHERE id = ?').run(role, req.params.memberId)
  res.json({ ok: true })
})

router.delete('/:memberId', (req, res) => {
  db.prepare('DELETE FROM pipe_members WHERE id = ?').run(req.params.memberId)
  res.json({ ok: true })
})

// ─── Regras de Encaminhamento ─────────────────────────────────────────────
// GET    /pipes/:pipeId/members/routing        → lista todas as regras do pipe
// POST   /pipes/:pipeId/members/routing        → cria regra { from_user_id, to_user_id }
// DELETE /pipes/:pipeId/members/routing/:id    → remove regra

router.get('/routing', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem ver as regras de encaminhamento.' })

  const rules = db.prepare(`
    SELECT r.id, r.from_user_id, r.to_user_id,
           fu.name as from_name, fu.email as from_email,
           tu.name as to_name,   tu.email as to_email, tu.avatar as to_avatar
    FROM pipe_routing_rules r
    JOIN users fu ON fu.id = r.from_user_id
    JOIN users tu ON tu.id = r.to_user_id
    WHERE r.pipe_id = ?
    ORDER BY fu.name, tu.name
  `).all(req.params.pipeId)
  res.json(rules)
})

router.post('/routing', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem configurar regras de encaminhamento.' })

  const { from_user_id, to_user_id } = req.body
  if (!from_user_id || !to_user_id)
    return res.status(400).json({ error: 'from_user_id e to_user_id são obrigatórios.' })
  if (from_user_id === to_user_id)
    return res.status(400).json({ error: 'Origem e destino não podem ser o mesmo usuário.' })

  const id = uuid()
  try {
    db.prepare('INSERT INTO pipe_routing_rules (id, pipe_id, from_user_id, to_user_id) VALUES (?, ?, ?, ?)')
      .run(id, req.params.pipeId, from_user_id, to_user_id)
  } catch {
    return res.status(409).json({ error: 'Esta regra já existe.' })
  }

  // Retorna a regra com os nomes para o frontend atualizar sem recarregar
  const rule = db.prepare(`
    SELECT r.id, r.from_user_id, r.to_user_id,
           fu.name as from_name, fu.email as from_email,
           tu.name as to_name,   tu.email as to_email, tu.avatar as to_avatar
    FROM pipe_routing_rules r
    JOIN users fu ON fu.id = r.from_user_id
    JOIN users tu ON tu.id = r.to_user_id
    WHERE r.id = ?
  `).get(id)
  res.json(rule)
})

router.delete('/routing/:ruleId', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem remover regras de encaminhamento.' })

  db.prepare('DELETE FROM pipe_routing_rules WHERE id = ? AND pipe_id = ?')
    .run(req.params.ruleId, req.params.pipeId)
  res.json({ ok: true })
})

// ─── Grupos de Encaminhamento ─────────────────────────────────────────────
// GET    /pipes/:pipeId/members/routing-groups          → lista grupos do pipe
// POST   /pipes/:pipeId/members/routing-groups          → cria grupo { from_user_id, group_type, group_value }
// DELETE /pipes/:pipeId/members/routing-groups/:id      → remove grupo

router.get('/routing-groups', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem ver os grupos de encaminhamento.' })

  const groups = db.prepare(`
    SELECT g.id, g.from_user_id, g.group_type, g.group_value,
           u.name as from_name,
           d.name as dept_name
    FROM pipe_routing_groups g
    JOIN users u ON u.id = g.from_user_id
    LEFT JOIN departments d ON d.id = g.group_value AND g.group_type = 'department'
    WHERE g.pipe_id = ?
    ORDER BY u.name, g.group_type, g.group_value
  `).all(req.params.pipeId)
  res.json(groups)
})

router.post('/routing-groups', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem configurar grupos de encaminhamento.' })

  const { from_user_id, group_type, group_value } = req.body
  if (!from_user_id || !group_type || !group_value)
    return res.status(400).json({ error: 'from_user_id, group_type e group_value são obrigatórios.' })
  if (!['pipe_role', 'department'].includes(group_type))
    return res.status(400).json({ error: 'group_type deve ser "pipe_role" ou "department".' })

  const id = uuid()
  try {
    db.prepare('INSERT INTO pipe_routing_groups (id, pipe_id, from_user_id, group_type, group_value) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.params.pipeId, from_user_id, group_type, group_value)
  } catch {
    return res.status(409).json({ error: 'Este grupo já está configurado para este membro.' })
  }

  const group = db.prepare(`
    SELECT g.id, g.from_user_id, g.group_type, g.group_value,
           u.name as from_name,
           d.name as dept_name
    FROM pipe_routing_groups g
    JOIN users u ON u.id = g.from_user_id
    LEFT JOIN departments d ON d.id = g.group_value AND g.group_type = 'department'
    WHERE g.id = ?
  `).get(id)
  res.json(group)
})

router.delete('/routing-groups/:groupId', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem remover grupos de encaminhamento.' })

  db.prepare('DELETE FROM pipe_routing_groups WHERE id = ? AND pipe_id = ?')
    .run(req.params.groupId, req.params.pipeId)
  res.json({ ok: true })
})

export default router
