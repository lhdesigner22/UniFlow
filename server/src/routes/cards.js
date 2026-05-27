import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'
import { emitToPipe } from '../socket.js'

const router = Router({ mergeParams: true })
router.use(auth)

async function logActivity(cardId, userId, action, details) {
  await db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), cardId, userId, action, details)
}

// Verifica se o usuário pode encaminhar um card para o destinatário solicitado.
// Retorna null se permitido, ou uma mensagem de erro se bloqueado.
async function checkRoutingAllowed(fromUserId, toUserId) {
  if (!toUserId) return null  // sem destinatário = sempre permitido

  // Busca regras globais do usuário
  const globalRules = await db.prepare(
    'SELECT to_user_id FROM user_routing_rules WHERE from_user_id = ?'
  ).all(fromUserId)

  if (globalRules.length === 0) return null  // sem restrição global

  const allowed = globalRules.some(r => r.to_user_id === toUserId)
  if (!allowed) {
    const dest = await db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId)
    return `Você não tem permissão para encaminhar cards para ${dest?.name ?? 'este usuário'}.`
  }

  return null
}

router.get('/', async (req, res) => {
  const { archived } = req.query
  const userId = req.user.id
  const pipeId = req.params.pipeId
  const archivedInt = archived === '1' ? 1 : 0

  // Determine visibility: admin/owner sees all; members see only their own cards
  const pipe   = await db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(pipeId)
  const member = await db.prepare('SELECT role FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(pipeId, userId)
  const isAdmin = pipe?.owner_id === userId || member?.role === 'admin'

  const base = `
    SELECT c.*, u.name as assignee_name, u.avatar as assignee_avatar,
           cb.name as created_by_name
    FROM cards c
    LEFT JOIN users u ON u.id = c.assignee_id
    LEFT JOIN users cb ON cb.id = c.created_by
    WHERE c.pipe_id = ? AND c.archived = ?`

  const cards = isAdmin
    ? await db.prepare(base + ' ORDER BY c.order_index').all(pipeId, archivedInt)
    : await db.prepare(base + ' AND (c.assignee_id = ? OR c.created_by = ?) ORDER BY c.order_index').all(pipeId, archivedInt, userId, userId)

  res.json(cards)
})

router.post('/', async (req, res) => {
  const { title, phase_id, assignee_id, due_date, priority = 'medium', labels = '[]' } = req.body
  if (!title || !phase_id) return res.status(400).json({ error: 'Título e fase obrigatórios' })

  // Valida regra de encaminhamento antes de salvar
  const routingError = await checkRoutingAllowed(req.user.id, assignee_id || null)
  if (routingError) return res.status(403).json({ error: routingError })

  const maxOrder = await db.scalar('SELECT MAX(order_index) FROM cards WHERE phase_id = ?', phase_id) ?? -1
  const id = uuid()
  await db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, assignee_id, due_date, priority, labels, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pipeId, phase_id, title, assignee_id || null, due_date || null, priority, labels, maxOrder + 1, req.user.id)
  await logActivity(id, req.user.id, 'created', 'Card criado')
  const card = await db.prepare('SELECT c.*, u.name as assignee_name FROM cards c LEFT JOIN users u ON u.id = c.assignee_id WHERE c.id = ?').get(id)
  emitToPipe(req.params.pipeId, 'card-created', { card })
  res.json(card)
})

router.get('/:id', async (req, res) => {
  const card = await db.prepare(`
    SELECT c.*, u.name as assignee_name, u.avatar as assignee_avatar,
           cb.name as created_by_name
    FROM cards c
    LEFT JOIN users u ON u.id = c.assignee_id
    LEFT JOIN users cb ON cb.id = c.created_by
    WHERE c.id = ?
  `).get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Card não encontrado' })
  card.fields = await db.prepare('SELECT cf.*, pf.name, pf.type, pf.options FROM card_fields cf JOIN pipe_fields pf ON pf.id = cf.field_id WHERE cf.card_id = ?').all(card.id)
  card.comments = await db.prepare('SELECT cc.*, u.name as user_name, u.avatar FROM card_comments cc JOIN users u ON u.id = cc.user_id WHERE cc.card_id = ? ORDER BY cc.created_at').all(card.id)
  card.attachments = await db.prepare('SELECT ca.*, u.name as user_name FROM card_attachments ca JOIN users u ON u.id = ca.user_id WHERE ca.card_id = ? ORDER BY ca.created_at DESC').all(card.id)
  card.checklist = await db.prepare('SELECT * FROM card_checklist WHERE card_id = ? ORDER BY order_index').all(card.id)
  card.activities = await db.prepare('SELECT ca.*, u.name as user_name, u.avatar FROM card_activities ca JOIN users u ON u.id = ca.user_id WHERE ca.card_id = ? ORDER BY ca.created_at DESC LIMIT 50').all(card.id)
  res.json(card)
})

router.put('/:id', async (req, res, next) => {
  try {
    const card = await db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id)
    if (!card) return res.status(404).json({ error: 'Card não encontrado' })
    const { title, assignee_id, due_date, priority, labels } = req.body

    // Valida regra de encaminhamento quando o destinatário foi alterado
    const newAssignee = assignee_id !== undefined ? assignee_id : card.assignee_id
    if (assignee_id !== undefined && assignee_id !== card.assignee_id) {
      const routingError = await checkRoutingAllowed(req.user.id, newAssignee)
      if (routingError) return res.status(403).json({ error: routingError })
    }

    if (card.phase_id !== req.body.phase_id && req.body.phase_id) {
      const oldPhase = await db.prepare('SELECT name FROM phases WHERE id = ?').get(card.phase_id)
      const newPhase = await db.prepare('SELECT name FROM phases WHERE id = ?').get(req.body.phase_id)
      await logActivity(card.id, req.user.id, 'moved', `Movido de "${oldPhase?.name}" para "${newPhase?.name}"`)
    }

    // Use an explicit JS timestamp to avoid SQL keyword issues across libsql versions
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await db.prepare('UPDATE cards SET title=?, assignee_id=?, due_date=?, priority=?, labels=?, phase_id=?, updated_at=? WHERE id=?')
      .run(title ?? card.title, newAssignee,
           due_date !== undefined ? due_date : card.due_date,
           priority ?? card.priority, labels ?? card.labels,
           req.body.phase_id ?? card.phase_id,
           now,
           card.id)
    await logActivity(card.id, req.user.id, 'updated', 'Card atualizado')
    const updated = await db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id)
    emitToPipe(req.params.pipeId, 'card-updated', { card: updated })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/move', async (req, res, next) => {
  try {
    const { phase_id, order_index } = req.body
    const card = await db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id)
    if (!card) return res.status(404).json({ error: 'Card não encontrado' })
    const oldPhase = await db.prepare('SELECT name FROM phases WHERE id = ?').get(card.phase_id)
    const newPhase = await db.prepare('SELECT name FROM phases WHERE id = ?').get(phase_id)
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await db.prepare('UPDATE cards SET phase_id = ?, order_index = ?, updated_at = ? WHERE id = ?')
      .run(phase_id, order_index, now, card.id)
    if (card.phase_id !== phase_id)
      await logActivity(card.id, req.user.id, 'moved', `Movido de "${oldPhase?.name}" para "${newPhase?.name}"`)
    emitToPipe(req.params.pipeId, 'card-moved', { cardId: card.id, phaseId: phase_id, orderIndex: order_index })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.post('/reorder', async (req, res) => {
  const { cards } = req.body // [{id, phase_id, order_index}]
  await db.batch(cards.map(c => ({
    sql: 'UPDATE cards SET phase_id = ?, order_index = ? WHERE id = ?',
    args: [c.phase_id, c.order_index, c.id]
  })))
  emitToPipe(req.params.pipeId, 'cards-reordered', { cards })
  res.json({ ok: true })
})

router.post('/:id/archive', async (req, res) => {
  await db.prepare('UPDATE cards SET archived = 1 WHERE id = ?').run(req.params.id)
  await logActivity(req.params.id, req.user.id, 'archived', 'Card arquivado')
  // Remove o card do board de todos os outros usuários
  emitToPipe(req.params.pipeId, 'card-deleted', { cardId: req.params.id })
  res.json({ ok: true })
})

router.post('/:id/restore', async (req, res) => {
  await db.prepare('UPDATE cards SET archived = 0 WHERE id = ?').run(req.params.id)
  await logActivity(req.params.id, req.user.id, 'restored', 'Card restaurado')
  const card = await db.prepare('SELECT c.*, u.name as assignee_name FROM cards c LEFT JOIN users u ON u.id = c.assignee_id WHERE c.id = ?').get(req.params.id)
  emitToPipe(req.params.pipeId, 'card-created', { card })
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id)
  emitToPipe(req.params.pipeId, 'card-deleted', { cardId: req.params.id })
  res.json({ ok: true })
})

// Card fields
router.put('/:id/fields', async (req, res) => {
  const { fields } = req.body // [{field_id, value}]
  await db.batch(fields.map(f => ({
    sql: 'INSERT INTO card_fields (id, card_id, field_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(card_id, field_id) DO UPDATE SET value = excluded.value',
    args: [uuid(), req.params.id, f.field_id, f.value]
  })))
  await logActivity(req.params.id, req.user.id, 'fields_updated', 'Campos atualizados')
  res.json({ ok: true })
})

// Checklist
router.post('/:id/checklist', async (req, res) => {
  const { title } = req.body
  const max = await db.scalar('SELECT MAX(order_index) FROM card_checklist WHERE card_id = ?', req.params.id) ?? -1
  const id = uuid()
  await db.prepare('INSERT INTO card_checklist (id, card_id, title, order_index) VALUES (?, ?, ?, ?)').run(id, req.params.id, title, max + 1)
  res.json(await db.prepare('SELECT * FROM card_checklist WHERE id = ?').get(id))
})

router.put('/:id/checklist/:itemId', async (req, res) => {
  const { done, title } = req.body
  await db.prepare('UPDATE card_checklist SET done = ?, title = ? WHERE id = ?').run(done, title, req.params.itemId)
  res.json({ ok: true })
})

router.delete('/:id/checklist/:itemId', async (req, res) => {
  await db.prepare('DELETE FROM card_checklist WHERE id = ?').run(req.params.itemId)
  res.json({ ok: true })
})

// Comments
router.post('/:id/comments', async (req, res) => {
  const { content } = req.body
  const id = uuid()
  await db.prepare('INSERT INTO card_comments (id, card_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, content)
  await logActivity(req.params.id, req.user.id, 'commented', content.substring(0, 80))
  const comment = await db.prepare('SELECT cc.*, u.name as user_name, u.avatar FROM card_comments cc JOIN users u ON u.id = cc.user_id WHERE cc.id = ?').get(id)
  res.json(comment)
})

router.delete('/:id/comments/:commentId', async (req, res) => {
  await db.prepare('DELETE FROM card_comments WHERE id = ? AND user_id = ?').run(req.params.commentId, req.user.id)
  res.json({ ok: true })
})

export default router
