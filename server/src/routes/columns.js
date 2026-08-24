import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// Confirma que o usuário é owner ou membro do quadro (montado sob /api/boards/:boardId/columns)
async function checkBoardAccess(db, boardId, userId) {
  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return { board: null, allowed: false }
  if (board.owner_id === userId) return { board, allowed: true }
  const member = await db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId)
  return { board, allowed: !!member }
}

// POST / — nova coluna, order_index = max+1
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { name } = await c.req.json()
  if (!name) return c.json({ error: 'Nome é obrigatório' }, 400)

  const maxIndex = await db.scalar('SELECT MAX(order_index) FROM columns WHERE board_id = ?', boardId)
  const orderIndex = (maxIndex ?? -1) + 1

  const id = uuid()
  await db.prepare('INSERT INTO columns (id, board_id, name, order_index) VALUES (?, ?, ?, ?)')
    .run(id, boardId, name, orderIndex)

  return c.json(await db.prepare('SELECT * FROM columns WHERE id = ?').get(id))
})

// PUT /:id
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const column = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!column) return c.json({ error: 'Coluna não encontrada' }, 404)

  const { name } = await c.req.json()
  await db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(name ?? column.name, id)

  return c.json(await db.prepare('SELECT * FROM columns WHERE id = ?').get(id))
})

// DELETE /:id — cascade nos cards da coluna e suas dependências
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const column = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ?').get(id, boardId)
  if (!column) return c.json({ error: 'Coluna não encontrada' }, 404)

  await db.batch([
    { sql: 'DELETE FROM time_entries WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_activities WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_checklist WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_comments WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_members WHERE card_id IN (SELECT id FROM cards WHERE column_id = ?)', args: [id] },
    { sql: 'DELETE FROM cards WHERE column_id = ?', args: [id] },
    { sql: 'DELETE FROM columns WHERE id = ?', args: [id] },
  ])

  return c.json({ ok: true })
})

// PUT /reorder — body { columns: [{id, order_index}] }
app.put('/reorder', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { columns } = await c.req.json()
  if (!Array.isArray(columns)) return c.json({ error: 'columns deve ser um array' }, 400)

  await db.batch(
    columns.map(col => ({
      sql: 'UPDATE columns SET order_index = ? WHERE id = ? AND board_id = ?',
      args: [col.order_index, col.id, boardId],
    }))
  )

  return c.json(await db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY order_index').all(boardId))
})

export default app
