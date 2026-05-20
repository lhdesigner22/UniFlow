import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()
router.use(auth)

// Verifica se o usuário pode encaminhar/adicionar outro usuário como destino
async function checkRoutingAllowed(fromUserId, toUserId) {
  if (!toUserId) return null
  const globalRules = await db.prepare(
    'SELECT to_user_id FROM user_routing_rules WHERE from_user_id = ?'
  ).all(fromUserId)
  if (globalRules.length === 0) return null  // sem restrição
  const allowed = globalRules.some(r => r.to_user_id === toUserId)
  if (!allowed) {
    const dest = await db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId)
    return `Você não tem permissão para adicionar ${dest?.name ?? 'este usuário'} ao pipe.`
  }
  return null
}

const getPipe = async (id, userId) => {
  const pipe = await db.prepare('SELECT * FROM pipes WHERE id = ?').get(id)
  if (!pipe) return null
  // Super admin tem acesso irrestrito a qualquer pipe
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  if (u?.system_role === 'super_admin') return pipe
  const member = await db.prepare('SELECT * FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(id, userId)
  if (!member && pipe.owner_id !== userId) return null
  return pipe
}

router.get('/', async (req, res) => {
  const pipes = await db.prepare(`
    SELECT p.*, pm.role FROM pipes p
    JOIN pipe_members pm ON pm.pipe_id = p.id AND pm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id)
  const result = await Promise.all(pipes.map(async p => ({
    ...p,
    cardCount: await db.scalar('SELECT COUNT(*) FROM cards WHERE pipe_id = ? AND archived = 0', p.id) ?? 0,
    memberCount: await db.scalar('SELECT COUNT(*) FROM pipe_members WHERE pipe_id = ?', p.id) ?? 0,
  })))
  res.json(result)
})

router.post('/', async (req, res) => {
  const { name, description, icon = '📋', color = '#4a7cf7', members = [] } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' })

  const id = uuid()
  await db.prepare('INSERT INTO pipes (id, name, description, icon, color, owner_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, description ?? null, icon, color, req.user.id)

  // Criador sempre entra como admin
  await db.prepare('INSERT INTO pipe_members (id, pipe_id, user_id, role) VALUES (?, ?, ?, ?)')
    .run(uuid(), id, req.user.id, 'admin')

  // Fases padrão
  const defaultPhases = [
    { name: 'A Fazer', color: '#7a8faa' },
    { name: 'Em Progresso', color: '#f59e0b' },
    { name: 'Concluído', color: '#22c55e', done: 1 },
  ]
  for (let i = 0; i < defaultPhases.length; i++) {
    const p = defaultPhases[i]
    await db.prepare('INSERT INTO phases (id, pipe_id, name, color, order_index, done) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), id, p.name, p.color, i, p.done || 0)
  }

  // Adicionar colaboradores convidados
  const notFound = []
  const blocked = []
  const added = []
  for (const email of members) {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) continue
    const user = await db.prepare('SELECT id, name, email FROM users WHERE LOWER(email) = ?').get(trimmed)
    if (!user) { notFound.push(trimmed); continue }
    if (user.id === req.user.id) continue // criador já está como admin

    // Valida regra de encaminhamento global
    const routingError = await checkRoutingAllowed(req.user.id, user.id)
    if (routingError) { blocked.push(user.email); continue }

    const already = await db.prepare('SELECT id FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(id, user.id)
    if (!already) {
      await db.prepare('INSERT INTO pipe_members (id, pipe_id, user_id, role) VALUES (?, ?, ?, ?)')
        .run(uuid(), id, user.id, 'member')
      added.push(user.name)
    }
  }

  const pipe = await db.prepare('SELECT * FROM pipes WHERE id = ?').get(id)
  res.json({ ...pipe, membersAdded: added, membersNotFound: notFound, membersBlocked: blocked })
})

router.get('/:id', async (req, res) => {
  const pipe = await getPipe(req.params.id, req.user.id)
  if (!pipe) return res.status(404).json({ error: 'Pipe não encontrado' })

  const userId = req.user.id
  const member = await db.prepare('SELECT role FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(pipe.id, userId)
  const isAdmin = pipe.owner_id === userId || member?.role === 'admin'

  const phases = await db.prepare('SELECT * FROM phases WHERE pipe_id = ? ORDER BY order_index').all(pipe.id)

  const cardBase = `SELECT c.*, u.name as assignee_name, u.avatar as assignee_avatar
    FROM cards c LEFT JOIN users u ON u.id = c.assignee_id
    WHERE c.pipe_id = ? AND c.archived = 0`
  const cards = isAdmin
    ? await db.prepare(cardBase + ' ORDER BY c.order_index').all(pipe.id)
    : await db.prepare(cardBase + ' AND (c.assignee_id = ? OR c.created_by = ?) ORDER BY c.order_index').all(pipe.id, userId, userId)

  const fields  = await db.prepare('SELECT * FROM pipe_fields WHERE pipe_id = ? ORDER BY order_index').all(pipe.id)
  const members = await db.prepare(`
    SELECT pm.id as member_id, pm.role,
           u.id, u.name, u.email, u.avatar,
           u.department_id, d.name as department_name
    FROM pipe_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE pm.pipe_id = ?
  `).all(pipe.id)
  const labels  = await db.prepare('SELECT * FROM pipe_labels WHERE pipe_id = ?').all(pipe.id)

  // ── Regras de encaminhamento para o usuário atual ─────────────────────
  // Prioridade 1: regras GLOBAIS por usuário (configuradas pelo admin no painel)
  const globalRules = await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar
    FROM user_routing_rules r
    JOIN users u ON u.id = r.to_user_id
    WHERE r.from_user_id = ?
  `).all(userId)

  let allowedAssignees = null

  if (globalRules.length > 0) {
    // Tem regras globais → filtra membros do pipe que estão na lista permitida
    const allowedIds = new Set(globalRules.map(u => u.id))
    const filtered = members.filter(m => allowedIds.has(m.id))
    allowedAssignees = filtered
  } else {
    // Prioridade 2: regras por pipe (configuradas nas settings do pipe)
    const individualRules = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar
      FROM pipe_routing_rules r JOIN users u ON u.id = r.to_user_id
      WHERE r.pipe_id = ? AND r.from_user_id = ?
    `).all(pipe.id, userId)

    const groupRules = await db.prepare(
      'SELECT group_type, group_value FROM pipe_routing_groups WHERE pipe_id = ? AND from_user_id = ?'
    ).all(pipe.id, userId)

    const groupMembers = []
    for (const g of groupRules) {
      if (g.group_type === 'pipe_role') {
        groupMembers.push(...await db.prepare(`
          SELECT u.id, u.name, u.email, u.avatar FROM pipe_members pm JOIN users u ON u.id = pm.user_id
          WHERE pm.pipe_id = ? AND pm.role = ? AND pm.user_id != ?
        `).all(pipe.id, g.group_value, userId))
      } else if (g.group_type === 'department') {
        groupMembers.push(...await db.prepare(`
          SELECT u.id, u.name, u.email, u.avatar FROM pipe_members pm JOIN users u ON u.id = pm.user_id
          WHERE pm.pipe_id = ? AND u.department_id = ? AND pm.user_id != ?
        `).all(pipe.id, g.group_value, userId))
      } else if (g.group_type === 'custom') {
        groupMembers.push(...await db.prepare(`
          SELECT u.id, u.name, u.email, u.avatar FROM pipe_custom_group_members cgm JOIN users u ON u.id = cgm.user_id
          WHERE cgm.group_id = ? AND cgm.user_id != ?
        `).all(g.group_value, userId))
      }
    }

    if (individualRules.length > 0 || groupRules.length > 0) {
      const seen = new Set()
      allowedAssignees = [...individualRules, ...groupMembers].filter(u => {
        if (seen.has(u.id)) return false; seen.add(u.id); return true
      })
    }
  }

  // Grupos customizados do pipe (para settings)
  const customGroups = await db.prepare(
    'SELECT g.id, g.name, g.color FROM pipe_custom_groups g WHERE g.pipe_id = ? ORDER BY g.name'
  ).all(pipe.id)

  res.json({ ...pipe, isAdmin, phases, cards, fields, members, labels, allowedAssignees, customGroups })
})

router.put('/:id', async (req, res) => {
  const pipe = await getPipe(req.params.id, req.user.id)
  if (!pipe) return res.status(404).json({ error: 'Pipe não encontrado' })
  const { name, description, icon, color } = req.body
  await db.prepare('UPDATE pipes SET name = ?, description = ?, icon = ?, color = ? WHERE id = ?')
    .run(name ?? pipe.name, description ?? pipe.description, icon ?? pipe.icon, color ?? pipe.color, pipe.id)
  res.json(await db.prepare('SELECT * FROM pipes WHERE id = ?').get(pipe.id))
})

router.delete('/:id', async (req, res) => {
  const pipe = await db.prepare('SELECT * FROM pipes WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!pipe) return res.status(403).json({ error: 'Sem permissão' })
  await db.prepare('DELETE FROM pipes WHERE id = ?').run(pipe.id)
  res.json({ ok: true })
})

export default router
