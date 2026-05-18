import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

function isPipeAdmin(pipeId, userId) {
  const u = db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  if (u?.system_role === 'super_admin') return true
  const pipe = db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(pipeId)
  if (pipe?.owner_id === userId) return true
  const member = db.prepare('SELECT role FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(pipeId, userId)
  return member?.role === 'admin'
}

// ─── CRUD de grupos personalizados ───────────────────────────────────────

// GET /pipes/:pipeId/groups — lista grupos com seus membros
router.get('/', (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.color, g.created_at,
           COUNT(gm.id) as member_count
    FROM pipe_custom_groups g
    LEFT JOIN pipe_custom_group_members gm ON gm.group_id = g.id
    WHERE g.pipe_id = ?
    GROUP BY g.id ORDER BY g.name
  `).all(req.params.pipeId)

  const result = groups.map(g => ({
    ...g,
    members: db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar
      FROM pipe_custom_group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? ORDER BY u.name
    `).all(g.id),
  }))

  res.json(result)
})

// POST /pipes/:pipeId/groups — cria grupo
router.post('/', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem criar grupos.' })

  const { name, color = '#4a7cf7' } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório.' })

  const id = uuid()
  try {
    db.prepare('INSERT INTO pipe_custom_groups (id, pipe_id, name, color) VALUES (?, ?, ?, ?)')
      .run(id, req.params.pipeId, name.trim(), color)
  } catch {
    return res.status(409).json({ error: 'Já existe um grupo com esse nome neste pipe.' })
  }

  res.json({ id, name: name.trim(), color, member_count: 0, members: [] })
})

// PUT /pipes/:pipeId/groups/:groupId — edita nome/cor
router.put('/:groupId', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem editar grupos.' })

  const g = db.prepare('SELECT * FROM pipe_custom_groups WHERE id = ? AND pipe_id = ?')
    .get(req.params.groupId, req.params.pipeId)
  if (!g) return res.status(404).json({ error: 'Grupo não encontrado.' })

  const { name, color } = req.body
  try {
    db.prepare('UPDATE pipe_custom_groups SET name = ?, color = ? WHERE id = ?')
      .run(name ?? g.name, color ?? g.color, g.id)
  } catch {
    return res.status(409).json({ error: 'Já existe um grupo com esse nome.' })
  }

  res.json(db.prepare('SELECT * FROM pipe_custom_groups WHERE id = ?').get(g.id))
})

// DELETE /pipes/:pipeId/groups/:groupId — exclui grupo e seus vínculos
router.delete('/:groupId', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem excluir grupos.' })

  // Remove membros, regras de encaminhamento que usam este grupo e o grupo
  db.prepare('DELETE FROM pipe_custom_group_members WHERE group_id = ?').run(req.params.groupId)
  db.prepare('DELETE FROM pipe_routing_groups WHERE group_type = ? AND group_value = ?')
    .run('custom', req.params.groupId)
  db.prepare('DELETE FROM pipe_custom_groups WHERE id = ? AND pipe_id = ?')
    .run(req.params.groupId, req.params.pipeId)

  res.json({ ok: true })
})

// ─── Membros do grupo ─────────────────────────────────────────────────────

// POST /pipes/:pipeId/groups/:groupId/members — adiciona membro ao grupo
router.post('/:groupId/members', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem gerenciar membros de grupos.' })

  const { user_id } = req.body
  if (!user_id) return res.status(400).json({ error: 'user_id obrigatório.' })

  // Garante que o usuário é membro do pipe
  const pipeMember = db.prepare('SELECT id FROM pipe_members WHERE pipe_id = ? AND user_id = ?')
    .get(req.params.pipeId, user_id)
  if (!pipeMember) return res.status(400).json({ error: 'Usuário não é membro deste pipe.' })

  const id = uuid()
  try {
    db.prepare('INSERT INTO pipe_custom_group_members (id, group_id, user_id) VALUES (?, ?, ?)')
      .run(id, req.params.groupId, user_id)
  } catch {
    return res.status(409).json({ error: 'Usuário já pertence a este grupo.' })
  }

  const user = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(user_id)
  res.json({ id, group_id: req.params.groupId, ...user })
})

// DELETE /pipes/:pipeId/groups/:groupId/members/:userId — remove membro do grupo
router.delete('/:groupId/members/:userId', (req, res) => {
  if (!isPipeAdmin(req.params.pipeId, req.user.id))
    return res.status(403).json({ error: 'Apenas admins podem gerenciar membros de grupos.' })

  db.prepare('DELETE FROM pipe_custom_group_members WHERE group_id = ? AND user_id = ?')
    .run(req.params.groupId, req.params.userId)

  res.json({ ok: true })
})

export default router
