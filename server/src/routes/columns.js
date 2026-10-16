import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { resolveBoardRole } from '../lib/boardAccess.js'

const app = new Hono()
app.use('*', auth)

// Confirma acesso ao quadro (montado sob /api/boards/:boardId/columns) — ver lib/boardAccess.js
async function checkBoardAccess(db, boardId, userId) {
  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return { board: null, allowed: false }
  const role = await resolveBoardRole(db, board, userId)
  return { board, allowed: !!role }
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

// (Antes do PUT /:id — senão o Hono casa "reorder" como :id e esta rota nunca roda.)
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

  return c.json(await db.prepare('SELECT * FROM columns WHERE board_id = ? AND deleted_at IS NULL ORDER BY order_index').all(boardId))
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

// DELETE /:id — manda pra lixeira (soft delete). Os cards continuam no
// banco intactos, só ficam invisíveis enquanto a coluna estiver excluída —
// ver POST /:id/restore pra reverter, e DELETE /:id/permanent pra apagar
// de vez (esse sim com o cascade completo).
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

  await db.prepare("UPDATE columns SET deleted_at = datetime('now') WHERE id = ?").run(id)
  return c.json({ ok: true })
})

// GET /trash — colunas excluídas deste quadro (mais recentes primeiro),
// com a contagem de cartões de cada uma pra mostrar na lixeira.
app.get('/trash', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const columns = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM cards WHERE column_id = c.id) as card_count
    FROM columns c
    WHERE c.board_id = ? AND c.deleted_at IS NOT NULL
    ORDER BY c.deleted_at DESC
  `).all(boardId)

  return c.json(columns)
})

// POST /:id/restore — tira da lixeira, volta pro fim do quadro
app.post('/:id/restore', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const column = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ? AND deleted_at IS NOT NULL').get(id, boardId)
  if (!column) return c.json({ error: 'Coluna não encontrada na lixeira' }, 404)

  const maxIndex = await db.scalar('SELECT MAX(order_index) FROM columns WHERE board_id = ? AND deleted_at IS NULL', boardId)
  await db.prepare('UPDATE columns SET deleted_at = NULL, order_index = ? WHERE id = ?').run((maxIndex ?? -1) + 1, id)

  return c.json(await db.prepare('SELECT * FROM columns WHERE id = ?').get(id))
})

// DELETE /:id/permanent — só a partir da lixeira. Esse sim apaga de vez,
// com o cascade completo (cards e tudo que depende deles).
app.delete('/:id/permanent', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardId = c.req.param('boardId')
  const id = c.req.param('id')

  const { board, allowed } = await checkBoardAccess(db, boardId, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const column = await db.prepare('SELECT * FROM columns WHERE id = ? AND board_id = ? AND deleted_at IS NOT NULL').get(id, boardId)
  if (!column) return c.json({ error: 'Coluna não encontrada na lixeira' }, 404)

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

export default app
