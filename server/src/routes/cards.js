import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

function logActivity(cardId, userId, action, details) {
  db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), cardId, userId, action, details)
}

// Verifica se o usuário pode encaminhar um card para o destinatário solicitado.
// Retorna null se permitido, ou uma mensagem de erro se bloqueado.
function checkRoutingAllowed(fromUserId, toUserId) {
  if (!toUserId) return null  // sem destinatário = sempre permitido

  // Busca regras globais do usuário
  const globalRules = db.prepare(
    'SELECT to_user_id FROM user_routing_rules WHERE from_user_id = ?'
  ).all(fromUserId)

  if (globalRules.length === 0) return null  // sem restrição global

  const allowed = globalRules.some(r => r.to_user_id === toUserId)
  if (!allowed) {
    const dest = db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId)
    return `Você não tem permissão para encaminhar cards para ${dest?.name ?? 'este usuário'}.`
  }

  return null
}

router.get('/', (req, res) => {
  const { archived } = req.query
  const userId = req.user.id
  const pipeId = req.params.pipeId
  const archivedInt = archived === '1' ? 1 : 0

  // Determine visibility: admin/owner sees all; members see only their own cards
  const pipe   = db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(pipeId)
  const member = db.prepare('SELECT role FROM pipe_members WHERE pipe_id = ? AND user_id = ?').get(pipeId, userId)
  const isAdmin = pipe?.owner_id === userId || member?.role === 'admin'

  const base = `
    SELECT c.*, u.name as assignee_name, u.avatar as assignee_avatar,
           cb.name as created_by_name
    FROM cards c
    LEFT JOIN users u ON u.id = c.assignee_id
    LEFT JOIN users cb ON cb.id = c.created_by
    WHERE c.pipe_id = ? AND c.archived = ?`

  const cards = isAdmin
    ? db.prepare(base + ' ORDER BY c.order_index').all(pipeId, archivedInt)
    : db.prepare(base + ' AND (c.assignee_id = ? OR c.created_by = ?) ORDER BY c.order_index').all(pipeId, archivedInt, userId, userId)

  res.json(cards)
})

router.post('/', (req, res) => {
  const { title, phase_id, assignee_id, due_date, priority = 'medium', labels = '[]' } = req.body
  if (!title || !phase_id) return res.status(400).json({ error: 'Título e fase obrigatórios' })

  // Valida regra de encaminhamento antes de salvar
  const routingError = checkRoutingAllowed(req.user.id, assignee_id || null)
  if (routingError) return res.status(403).json({ error: routingError })

  const maxOrder = db.scalar('SELECT MAX(order_index) FROM cards WHERE phase_id = ?', phase_id) ?? -1
  const id = uuid()
  db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, assignee_id, due_date, priority, labels, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pipeId, phase_id, title, assignee_id || null, due_date || null, priority, labels, maxOrder + 1, req.user.id)
  logActivity(id, req.user.id, 'created', 'Card criado')
  const card = db.prepare('SELECT c.*, u.name as assignee_name FROM cards c LEFT JOIN users u ON u.id = c.assignee_id WHERE c.id = ?').get(id)
  res.json(card)
})

router.get('/:id', (req, res) => {
  const card = db.prepare(`
    SELECT c.*, u.name as assignee_name, u.avatar as assignee_avatar,
           cb.name as created_by_name
    FROM cards c
    LEFT JOIN users u ON u.id = c.assignee_id
    LEFT JOIN users cb ON cb.id = c.created_by
    WHERE c.id = ?
  `).get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Card não encontrado' })
  card.fields = db.prepare('SELECT cf.*, pf.name, pf.type, pf.options FROM card_fields cf JOIN pipe_fields pf ON pf.id = cf.field_id WHERE cf.card_id = ?').all(card.id)
  card.comments = db.prepare('SELECT cc.*, u.name as user_name, u.avatar FROM card_comments cc JOIN users u ON u.id = cc.user_id WHERE cc.card_id = ? ORDER BY cc.created_at').all(card.id)
  card.attachments = db.prepare('SELECT ca.*, u.name as user_name FROM card_attachments ca JOIN users u ON u.id = ca.user_id WHERE ca.card_id = ? ORDER BY ca.created_at DESC').all(card.id)
  card.checklist = db.prepare('SELECT * FROM card_checklist WHERE card_id = ? ORDER BY order_index').all(card.id)
  card.activities = db.prepare('SELECT ca.*, u.name as user_name, u.avatar FROM card_activities ca JOIN users u ON u.id = ca.user_id WHERE ca.card_id = ? ORDER BY ca.created_at DESC LIMIT 50').all(card.id)
  res.json(card)
})

router.put('/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Card não encontrado' })
  const { title, assignee_id, due_date, priority, labels } = req.body

  // Valida regra de encaminhamento quando o destinatário foi alterado
  const newAssignee = assignee_id !== undefined ? assignee_id : card.assignee_id
  if (assignee_id !== undefined && assignee_id !== card.assignee_id) {
    const routingError = checkRoutingAllowed(req.user.id, newAssignee)
    if (routingError) return res.status(403).json({ error: routingError })
  }

  if (card.phase_id !== req.body.phase_id && req.body.phase_id) {
    const oldPhase = db.prepare('SELECT name FROM phases WHERE id = ?').get(card.phase_id)
    const newPhase = db.prepare('SELECT name FROM phases WHERE id = ?').get(req.body.phase_id)
    logActivity(card.id, req.user.id, 'moved', `Movido de "${oldPhase?.name}" para "${newPhase?.name}"`)
  }
  db.prepare('UPDATE cards SET title=?, assignee_id=?, due_date=?, priority=?, labels=?, phase_id=?, updated_at=datetime("now") WHERE id=?')
    .run(title ?? card.title, newAssignee,
         due_date !== undefined ? due_date : card.due_date,
         priority ?? card.priority, labels ?? card.labels,
         req.body.phase_id ?? card.phase_id, card.id)
  logActivity(card.id, req.user.id, 'updated', 'Card atualizado')
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id))
})

router.post('/:id/move', (req, res) => {
  const { phase_id, order_index } = req.body
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Card não encontrado' })
  const oldPhase = db.prepare('SELECT name FROM phases WHERE id = ?').get(card.phase_id)
  const newPhase = db.prepare('SELECT name FROM phases WHERE id = ?').get(phase_id)
  db.prepare('UPDATE cards SET phase_id = ?, order_index = ?, updated_at = datetime("now") WHERE id = ?')
    .run(phase_id, order_index, card.id)
  if (card.phase_id !== phase_id)
    logActivity(card.id, req.user.id, 'moved', `Movido de "${oldPhase?.name}" para "${newPhase?.name}"`)
  res.json({ ok: true })
})

router.post('/reorder', (req, res) => {
  const { cards } = req.body // [{id, phase_id, order_index}]
  const update = db.prepare('UPDATE cards SET phase_id = ?, order_index = ? WHERE id = ?')
  db.transaction(() => cards.forEach(c => update.run(c.phase_id, c.order_index, c.id)))()
  res.json({ ok: true })
})

router.post('/:id/archive', (req, res) => {
  db.prepare('UPDATE cards SET archived = 1 WHERE id = ?').run(req.params.id)
  logActivity(req.params.id, req.user.id, 'archived', 'Card arquivado')
  res.json({ ok: true })
})

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE cards SET archived = 0 WHERE id = ?').run(req.params.id)
  logActivity(req.params.id, req.user.id, 'restored', 'Card restaurado')
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Card fields
router.put('/:id/fields', (req, res) => {
  const { fields } = req.body // [{field_id, value}]
  const upsert = db.prepare('INSERT INTO card_fields (id, card_id, field_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(card_id, field_id) DO UPDATE SET value = excluded.value')
  db.transaction(() => fields.forEach(f => upsert.run(uuid(), req.params.id, f.field_id, f.value)))()
  logActivity(req.params.id, req.user.id, 'fields_updated', 'Campos atualizados')
  res.json({ ok: true })
})

// Checklist
router.post('/:id/checklist', (req, res) => {
  const { title } = req.body
  const max = db.scalar('SELECT MAX(order_index) FROM card_checklist WHERE card_id = ?', req.params.id) ?? -1
  const id = uuid()
  db.prepare('INSERT INTO card_checklist (id, card_id, title, order_index) VALUES (?, ?, ?, ?)').run(id, req.params.id, title, max + 1)
  res.json(db.prepare('SELECT * FROM card_checklist WHERE id = ?').get(id))
})

router.put('/:id/checklist/:itemId', (req, res) => {
  const { done, title } = req.body
  db.prepare('UPDATE card_checklist SET done = ?, title = ? WHERE id = ?').run(done, title, req.params.itemId)
  res.json({ ok: true })
})

router.delete('/:id/checklist/:itemId', (req, res) => {
  db.prepare('DELETE FROM card_checklist WHERE id = ?').run(req.params.itemId)
  res.json({ ok: true })
})

// Comments
router.post('/:id/comments', (req, res) => {
  const { content } = req.body
  const id = uuid()
  db.prepare('INSERT INTO card_comments (id, card_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, content)
  logActivity(req.params.id, req.user.id, 'commented', content.substring(0, 80))
  const comment = db.prepare('SELECT cc.*, u.name as user_name, u.avatar FROM card_comments cc JOIN users u ON u.id = cc.user_id WHERE cc.id = ?').get(id)
  res.json(comment)
})

router.delete('/:id/comments/:commentId', (req, res) => {
  db.prepare('DELETE FROM card_comments WHERE id = ? AND user_id = ?').run(req.params.commentId, req.user.id)
  res.json({ ok: true })
})

export default router
