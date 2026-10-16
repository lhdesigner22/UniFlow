import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { createNotification } from './notifications.js'
import { resolveBoardRole } from '../lib/boardAccess.js'

const app = new Hono()
app.use('*', auth)

// Status do cartão no estilo Planner — independente da coluna (bucket) em
// que ele está. Usado pelo card em si e pelas métricas de conclusão.
const PROGRESS_VALUES = ['not_started', 'in_progress', 'completed']
const PROGRESS_LABELS = { not_started: 'Não iniciado', in_progress: 'Em andamento', completed: 'Concluído' }

async function logActivity(db, cardId, userId, action, details) {
  await db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), cardId, userId, action, details)
}

// Confirma acesso ao quadro (montado sob /api/boards/:boardId/cards) — ver lib/boardAccess.js
async function checkBoardAccess(db, boardId, userId) {
  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return { board: null, allowed: false }
  const role = await resolveBoardRole(db, board, userId)
  return { board, allowed: !!role }
}

async function getCardMembers(db, cardId) {
  return await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar
    FROM card_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.card_id = ?
    ORDER BY cm.created_at
  `).all(cardId)
}

// GET / — todos os cards do quadro (archived=0 por padrão)
app.get('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const archived = c.req.query('archived') === '1' ? 1 : 0

  const cards = await db.prepare(`
    SELECT cd.*, col.name as column_name
    FROM cards cd JOIN columns col ON col.id = cd.column_id
    WHERE cd.board_id = ? AND cd.archived = ? AND col.deleted_at IS NULL
    ORDER BY cd.column_id, cd.order_index
  `).all(boardId, archived)

  return c.json(cards)
})

// POST / — cria card
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { title, description, column_id, due_date, priority, progress } = await c.req.json()
  if (!title) return c.json({ error: 'Título é obrigatório' }, 400)
  if (!column_id) return c.json({ error: 'column_id é obrigatório' }, 400)
  if (progress !== undefined && !PROGRESS_VALUES.includes(progress)) return c.json({ error: 'progress inválido' }, 400)

  const column = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ?').get(column_id, boardId)
  if (!column) return c.json({ error: 'Coluna não encontrada neste quadro' }, 400)

  const maxIndex = await db.scalar('SELECT MAX(order_index) FROM cards WHERE column_id = ?', column_id)
  const orderIndex = (maxIndex ?? -1) + 1

  const id = uuid()
  await db.prepare(`
    INSERT INTO cards (id, board_id, column_id, title, description, due_date, priority, progress, order_index, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, boardId, column_id, title, description || null, due_date || null, priority || null, progress || 'not_started', orderIndex, user.id)

  await logActivity(db, id, user.id, 'created', 'Cartão criado')

  return c.json(await db.prepare('SELECT * FROM cards WHERE id = ?').get(id))
})

// GET /:id — detalhe completo
app.get('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  card.members = await getCardMembers(db, id)
  card.labels = await db.prepare(`
    SELECT bl.id, bl.name, bl.color
    FROM card_labels cl JOIN board_labels bl ON bl.id = cl.label_id
    WHERE cl.card_id = ?
  `).all(id)
  card.checklist = await db.prepare('SELECT * FROM card_checklist WHERE card_id = ? ORDER BY order_index').all(id)
  card.comments = await db.prepare(`
    SELECT cc.*, u.name as user_name, u.avatar
    FROM card_comments cc JOIN users u ON u.id = cc.user_id
    WHERE cc.card_id = ? ORDER BY cc.created_at
  `).all(id)
  card.activities = await db.prepare(`
    SELECT ca.*, u.name as user_name
    FROM card_activities ca JOIN users u ON u.id = ca.user_id
    WHERE ca.card_id = ? ORDER BY ca.created_at DESC LIMIT 50
  `).all(id)
  card.time_entries = await db.prepare(`
    SELECT te.*, u.name as user_name, u.avatar
    FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.card_id = ? ORDER BY te.created_at DESC
  `).all(id)
  card.total_seconds = await db.scalar(
    'SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries WHERE card_id = ? AND duration_seconds IS NOT NULL',
    id
  ) ?? 0

  return c.json(card)
})

// PUT /:id — update parcial
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const body = await c.req.json()
  const { title, description, due_date, priority, progress } = body
  if (progress !== undefined && !PROGRESS_VALUES.includes(progress)) return c.json({ error: 'progress inválido' }, 400)

  const newTitle = title ?? card.title
  const newDescription = description !== undefined ? description : card.description
  const newDueDate = due_date !== undefined ? due_date : card.due_date
  const newPriority = priority !== undefined ? priority : card.priority
  const newProgress = progress !== undefined ? progress : card.progress

  // completed_at só fica preenchido enquanto o status for 'completed' — vira
  // a base das métricas de "quando foi concluído"; se voltar atrás, limpa.
  const completingNow = newProgress === 'completed' && card.progress !== 'completed'
  const uncompletingNow = newProgress !== 'completed' && card.progress === 'completed'

  await db.prepare(`
    UPDATE cards SET title = ?, description = ?, due_date = ?, priority = ?, progress = ?,
      completed_at = CASE WHEN ? = 1 THEN datetime('now') WHEN ? = 1 THEN NULL ELSE completed_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(newTitle, newDescription, newDueDate, newPriority, newProgress, completingNow ? 1 : 0, uncompletingNow ? 1 : 0, id)

  if (progress !== undefined && progress !== card.progress) {
    await logActivity(db, id, user.id, 'progress', PROGRESS_LABELS[newProgress] || newProgress)
  }

  return c.json(await db.prepare('SELECT * FROM cards WHERE id = ?').get(id))
})

// POST /:id/move — muda coluna/posição
app.post('/:id/move', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { column_id, order_index } = await c.req.json()
  if (!column_id) return c.json({ error: 'column_id é obrigatório' }, 400)

  const targetColumn = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ?').get(column_id, boardId)
  if (!targetColumn) return c.json({ error: 'Coluna não encontrada neste quadro' }, 400)

  await db.prepare(`
    UPDATE cards SET column_id = ?, order_index = ?, updated_at = datetime('now') WHERE id = ?
  `).run(column_id, order_index ?? 0, id)

  if (column_id !== card.column_id) {
    const oldColumn = await db.prepare('SELECT name FROM columns WHERE id = ?').get(card.column_id)
    await logActivity(db, id, user.id, 'moved', `De '${oldColumn?.name ?? '?'}' para '${targetColumn.name}'`)
  }

  return c.json(await db.prepare('SELECT * FROM cards WHERE id = ?').get(id))
})

// DELETE /:id
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  await db.batch([
    { sql: 'DELETE FROM time_entries WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM card_activities WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM card_checklist WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM card_comments WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM card_labels WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM card_members WHERE card_id = ?', args: [id] },
    { sql: 'DELETE FROM cards WHERE id = ?', args: [id] },
  ])

  return c.json({ ok: true })
})

// POST /:id/members
app.post('/:id/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { user_id } = await c.req.json()
  if (!user_id) return c.json({ error: 'user_id é obrigatório' }, 400)

  await db.prepare('INSERT INTO card_members (id, card_id, user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(uuid(), id, user_id)

  try {
    await createNotification(db, user_id, 'card', 'Você foi adicionado a um cartão', card.title, null)
  } catch (err) {
    console.error('Falha ao notificar novo membro do cartão:', err)
  }

  return c.json(await getCardMembers(db, id))
})

// DELETE /:id/members/:userId
app.delete('/:id/members/:userId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  await db.prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?').run(id, targetUserId)
  return c.json({ ok: true })
})

// POST /:id/labels
app.post('/:id/labels', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { label_id } = await c.req.json()
  if (!label_id) return c.json({ error: 'label_id é obrigatório' }, 400)

  const label = await db.prepare('SELECT * FROM board_labels WHERE id = ? AND board_id = ?').get(label_id, boardId)
  if (!label) return c.json({ error: 'Etiqueta não encontrada neste quadro' }, 400)

  await db.prepare('INSERT INTO card_labels (id, card_id, label_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(uuid(), id, label_id)

  return c.json(await db.prepare(`
    SELECT bl.id, bl.name, bl.color
    FROM card_labels cl JOIN board_labels bl ON bl.id = cl.label_id
    WHERE cl.card_id = ?
  `).all(id))
})

// DELETE /:id/labels/:labelId
app.delete('/:id/labels/:labelId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')
  const labelId = c.req.param('labelId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  await db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(id, labelId)
  return c.json({ ok: true })
})

// POST /:id/checklist
app.post('/:id/checklist', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { title } = await c.req.json()
  if (!title) return c.json({ error: 'Título é obrigatório' }, 400)

  const maxIndex = await db.scalar('SELECT MAX(order_index) FROM card_checklist WHERE card_id = ?', id)
  const orderIndex = (maxIndex ?? -1) + 1

  const itemId = uuid()
  await db.prepare('INSERT INTO card_checklist (id, card_id, title, done, order_index) VALUES (?, ?, ?, 0, ?)')
    .run(itemId, id, title, orderIndex)

  return c.json(await db.prepare('SELECT * FROM card_checklist WHERE id = ?').get(itemId))
})

// PUT /:id/checklist/:itemId
app.put('/:id/checklist/:itemId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const item = await db.prepare('SELECT * FROM card_checklist WHERE id = ? AND card_id = ?').get(itemId, id)
  if (!item) return c.json({ error: 'Item não encontrado' }, 404)

  const { title, done } = await c.req.json()
  const newTitle = title ?? item.title
  const newDone = done !== undefined ? (done ? 1 : 0) : item.done

  await db.prepare('UPDATE card_checklist SET title = ?, done = ? WHERE id = ?').run(newTitle, newDone, itemId)

  return c.json(await db.prepare('SELECT * FROM card_checklist WHERE id = ?').get(itemId))
})

// DELETE /:id/checklist/:itemId
app.delete('/:id/checklist/:itemId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  await db.prepare('DELETE FROM card_checklist WHERE id = ? AND card_id = ?').run(itemId, id)
  return c.json({ ok: true })
})

// POST /:id/comments
app.post('/:id/comments', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { content } = await c.req.json()
  if (!content) return c.json({ error: 'Conteúdo é obrigatório' }, 400)

  const commentId = uuid()
  await db.prepare('INSERT INTO card_comments (id, card_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(commentId, id, user.id, content)
  await logActivity(db, id, user.id, 'commented', content.substring(0, 80))

  const comment = await db.prepare(`
    SELECT cc.*, u.name as user_name, u.avatar
    FROM card_comments cc JOIN users u ON u.id = cc.user_id
    WHERE cc.id = ?
  `).get(commentId)

  try {
    const members = await getCardMembers(db, id)
    for (const member of members) {
      if (member.id === user.id) continue
      await createNotification(db, member.id, 'comment', 'Novo comentário', content.substring(0, 80), null)
    }
  } catch (err) {
    console.error('Falha ao notificar comentário do cartão:', err)
  }

  return c.json(comment)
})

// DELETE /:id/comments/:commentId — apenas o próprio autor
app.delete('/:id/comments/:commentId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')
  const commentId = c.req.param('commentId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  await db.prepare('DELETE FROM card_comments WHERE id = ? AND card_id = ? AND user_id = ?').run(commentId, id, user.id)
  return c.json({ ok: true })
})

export default app
