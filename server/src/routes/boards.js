import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { createNotification } from './notifications.js'
import { resolveBoardRole, getVisibleBoardIds, isSuperAdmin } from '../lib/boardAccess.js'

const app = new Hono()
app.use('*', auth)

const DEFAULT_COLUMNS = ['A Fazer', 'Em Andamento', 'Concluído']

// Resolve o board + o papel do usuário requisitante nele (ver lib/boardAccess.js).
async function getBoardAccess(db, boardId, userId) {
  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return { board: null, role: null }
  return { board, role: await resolveBoardRole(db, board, userId) }
}

async function getMembers(db, boardId) {
  return await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, bm.role
    FROM board_members bm JOIN users u ON u.id = bm.user_id
    WHERE bm.board_id = ?
    ORDER BY bm.created_at
  `).all(boardId)
}

// GET / — quadros onde sou owner ou membro, MAIS (se eu for Super Admin com
// departamento definido) os quadros de qualquer dono do meu departamento —
// visão de controle por área (ver lib/boardAccess.js). Por padrão só os
// ativos (não arquivados); `?archived=1` traz só os arquivados (usado pela
// tela de "Quadros arquivados", pra restaurar).
app.get('/', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  const wantArchived = c.req.query('archived') === '1' ? 1 : 0

  const visibleIds = await getVisibleBoardIds(db, userId)
  if (visibleIds.length === 0) return c.json([])

  const placeholders = visibleIds.map(() => '?').join(',')
  const boards = await db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM board_members WHERE board_id = b.id) as member_count
    FROM boards b
    WHERE b.id IN (${placeholders}) AND COALESCE(b.archived, 0) = ?
    ORDER BY b.created_at DESC
  `).all(...visibleIds, wantArchived)

  // Auditor vê tudo por um motivo diferente (perfil de leitura total, não
  // "mesmo departamento") — não rotula os quadros dele como "visão de
  // departamento", que seria enganoso.
  const isAuditor = (await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId))?.system_role === 'auditor'

  for (const board of boards) {
    board.members = await getMembers(db, board.id)
    // Sinaliza pro frontend que este quadro apareceu por "visão de
    // departamento" (não porque o usuário é dono/membro de fato) — pra UI
    // poder deixar isso claro em vez de confundir com um convite normal.
    board.is_dept_view = !isAuditor && board.owner_id !== userId && !board.members.some(m => m.id === userId)
  }

  return c.json(boards)
})

// POST / — cria quadro + owner como membro admin + 3 colunas default
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { name, description, color } = await c.req.json()
  if (!name) return c.json({ error: 'Nome é obrigatório' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO boards (id, name, description, color, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, description || null, color || '#0EA5A5', user.id)

  await db.prepare('INSERT INTO board_members (id, board_id, user_id, role) VALUES (?, ?, ?, ?)')
    .run(uuid(), id, user.id, 'admin')

  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    await db.prepare('INSERT INTO columns (id, board_id, name, order_index) VALUES (?, ?, ?, ?)')
      .run(uuid(), id, DEFAULT_COLUMNS[i], i)
  }

  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(id)
  return c.json(board)
})

// GET /:id — quadro completo (colunas, membros, etiquetas)
app.get('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  board.columns = await db.prepare('SELECT * FROM columns WHERE board_id = ? AND deleted_at IS NULL ORDER BY order_index').all(id)
  board.members = await getMembers(db, id)
  board.labels = await db.prepare('SELECT * FROM board_labels WHERE board_id = ?').all(id)
  board.my_role = role

  return c.json(board)
})

// PUT /:id — owner ou admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Sem permissão' }, 403)

  const { name, description, color } = await c.req.json()
  await db.prepare('UPDATE boards SET name = ?, description = ?, color = ? WHERE id = ?')
    .run(name ?? board.name, description !== undefined ? description : board.description, color ?? board.color, id)

  return c.json(await db.prepare('SELECT * FROM boards WHERE id = ?').get(id))
})

// POST /:id/archive — owner, admin, OU qualquer Super Admin com acesso ao
// quadro (dono, membro comum, ou só por visão de departamento — qualquer
// papel não-nulo). Some da lista principal sem apagar nada (colunas/cards/
// histórico/lançamentos de tempo continuam intactos).
app.post('/:id/archive', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)
  if (role !== 'owner' && role !== 'admin' && !(await isSuperAdmin(db, user.id))) {
    return c.json({ error: 'Sem permissão' }, 403)
  }

  await db.prepare('UPDATE boards SET archived = 1 WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// POST /:id/unarchive — mesma regra do archive acima
app.post('/:id/unarchive', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)
  if (role !== 'owner' && role !== 'admin' && !(await isSuperAdmin(db, user.id))) {
    return c.json({ error: 'Sem permissão' }, 403)
  }

  await db.prepare('UPDATE boards SET archived = 0 WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// DELETE /:id — owner apenas. Cascade completo.
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (role !== 'owner') return c.json({ error: 'Apenas o proprietário pode excluir o quadro' }, 403)

  await db.batch([
    { sql: 'DELETE FROM time_entries WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_activities WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_checklist WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_comments WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM card_members WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)', args: [id] },
    { sql: 'DELETE FROM cards WHERE board_id = ?', args: [id] },
    { sql: 'DELETE FROM columns WHERE board_id = ?', args: [id] },
    { sql: 'DELETE FROM board_labels WHERE board_id = ?', args: [id] },
    { sql: 'DELETE FROM board_members WHERE board_id = ?', args: [id] },
    { sql: 'DELETE FROM boards WHERE id = ?', args: [id] },
  ])

  return c.json({ ok: true })
})

// GET /:id/members
app.get('/:id/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  return c.json(await getMembers(db, id))
})

// POST /:id/members — convida um usuário (qualquer membro pode convidar)
app.post('/:id/members', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { user_id } = await c.req.json()
  if (!user_id) return c.json({ error: 'user_id é obrigatório' }, 400)

  await db.prepare('INSERT INTO board_members (id, board_id, user_id, role) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(uuid(), id, user_id, 'member')

  try {
    await createNotification(db, user_id, 'board', 'Você foi adicionado a um quadro', board.name, null)
  } catch (err) {
    console.error('Falha ao notificar novo membro do quadro:', err)
  }

  return c.json(await getMembers(db, id))
})

// DELETE /:id/members/:userId — não é possível remover o owner
app.delete('/:id/members/:userId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)
  if (targetUserId === board.owner_id) return c.json({ error: 'Não é possível remover o proprietário do quadro' }, 400)

  // Um membro pode se auto-remover; caso contrário, precisa ser owner/admin
  if (targetUserId !== user.id && role !== 'owner' && role !== 'admin') {
    return c.json({ error: 'Sem permissão' }, 403)
  }

  await db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(id, targetUserId)
  return c.json({ ok: true })
})

// GET /:id/labels
app.get('/:id/labels', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  return c.json(await db.prepare('SELECT * FROM board_labels WHERE board_id = ?').all(id))
})

// POST /:id/labels
app.post('/:id/labels', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { name, color } = await c.req.json()
  if (!name) return c.json({ error: 'Nome é obrigatório' }, 400)

  const labelId = uuid()
  await db.prepare('INSERT INTO board_labels (id, board_id, name, color) VALUES (?, ?, ?, ?)')
    .run(labelId, id, name, color || '#0EA5A5')

  return c.json(await db.prepare('SELECT * FROM board_labels WHERE id = ?').get(labelId))
})

// DELETE /:id/labels/:labelId — cascade nos card_labels que referenciam a etiqueta
app.delete('/:id/labels/:labelId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const labelId = c.req.param('labelId')

  const { board, role } = await getBoardAccess(db, id, user.id)
  if (!board) return c.json({ error: 'Quadro não encontrado' }, 404)
  if (!role) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  await db.batch([
    { sql: 'DELETE FROM card_labels WHERE label_id = ?', args: [labelId] },
    { sql: 'DELETE FROM board_labels WHERE id = ? AND board_id = ?', args: [labelId, id] },
  ])

  return c.json({ ok: true })
})

export default app
