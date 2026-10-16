import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { getVisibleBoardIds } from '../lib/boardAccess.js'
import { escapeCsv } from '../lib/csv.js'

// Roteador único montado em `/api` (bare) no worker.js — os caminhos completos
// são escritos por extenso aqui dentro (/cards/:cardId/time/..., /time/...)
// pra resolver exatamente nas rotas exigidas pelo cliente.
const app = new Hono()
app.use('*', auth)

async function checkBoardAccess(db, boardId, userId) {
  const board = await db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return { board: null, allowed: false }
  if (board.owner_id === userId) return { board, allowed: true }
  const member = await db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId)
  return { board, allowed: !!member }
}

// D1 grava `datetime('now')` como 'YYYY-MM-DD HH:MM:SS' em UTC, sem sufixo 'Z'
// (mesma convenção usada em toda a base, ex: `created_at` default) — pra
// interpretar corretamente em JS como UTC, troca o espaço por 'T' e
// acrescenta 'Z' antes de fazer o parse.
function parseDbTimestamp(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z')
}

function formatHoursMinutes(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

// POST /cards/:cardId/time/start
app.post('/cards/:cardId/time/start', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const cardId = c.req.param('cardId')

  const card = await db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)
  const { allowed } = await checkBoardAccess(db, card.board_id, user.id)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  // Se o usuário já tiver um cronômetro rodando em QUALQUER card, para ele primeiro
  const running = await db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL').get(user.id)
  if (running) {
    const durationSeconds = Math.round((Date.now() - parseDbTimestamp(running.started_at).getTime()) / 1000)
    await db.prepare("UPDATE time_entries SET ended_at = datetime('now'), duration_seconds = ? WHERE id = ?")
      .run(Math.max(0, durationSeconds), running.id)
  }

  const id = uuid()
  await db.prepare(`
    INSERT INTO time_entries (id, card_id, user_id, started_at, ended_at, duration_seconds)
    VALUES (?, ?, ?, datetime('now'), NULL, NULL)
  `).run(id, cardId, user.id)

  return c.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id))
})

// POST /cards/:cardId/time/stop
app.post('/cards/:cardId/time/stop', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const cardId = c.req.param('cardId')

  const entry = await db.prepare(
    'SELECT * FROM time_entries WHERE card_id = ? AND user_id = ? AND ended_at IS NULL'
  ).get(cardId, user.id)
  if (!entry) return c.json({ error: 'Nenhum cronômetro em andamento para este cartão' }, 404)

  const durationSeconds = Math.max(0, Math.round((Date.now() - parseDbTimestamp(entry.started_at).getTime()) / 1000))
  await db.prepare("UPDATE time_entries SET ended_at = datetime('now'), duration_seconds = ? WHERE id = ?")
    .run(durationSeconds, entry.id)

  return c.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entry.id))
})

// POST /cards/:cardId/time — lançamento manual
app.post('/cards/:cardId/time', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const cardId = c.req.param('cardId')

  const card = await db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)
  const { allowed } = await checkBoardAccess(db, card.board_id, user.id)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const { duration_seconds, note, date } = await c.req.json()
  if (typeof duration_seconds !== 'number' || !Number.isFinite(duration_seconds) || duration_seconds <= 0) {
    return c.json({ error: 'duration_seconds deve ser um número positivo' }, 400)
  }

  const id = uuid()
  if (date) {
    await db.prepare(`
      INSERT INTO time_entries (id, card_id, user_id, started_at, ended_at, duration_seconds, note)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, cardId, user.id, date, Math.round(duration_seconds), note || null)
  } else {
    await db.prepare(`
      INSERT INTO time_entries (id, card_id, user_id, started_at, ended_at, duration_seconds, note)
      VALUES (?, ?, ?, datetime('now'), NULL, ?, ?)
    `).run(id, cardId, user.id, Math.round(duration_seconds), note || null)
  }

  return c.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id))
})

// GET /cards/:cardId/time
app.get('/cards/:cardId/time', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const cardId = c.req.param('cardId')

  const card = await db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
  if (!card) return c.json({ error: 'Cartão não encontrado' }, 404)
  const { allowed } = await checkBoardAccess(db, card.board_id, user.id)
  if (!allowed) return c.json({ error: 'Sem acesso a este quadro' }, 403)

  const entries = await db.prepare(`
    SELECT te.*, u.name as user_name
    FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.card_id = ? ORDER BY te.created_at DESC
  `).all(cardId)

  const totalSeconds = await db.scalar(
    'SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries WHERE card_id = ? AND duration_seconds IS NOT NULL',
    cardId
  ) ?? 0

  return c.json({ entries, total_seconds: totalSeconds })
})

// GET /time/running — cronômetro ativo do usuário atual, em qualquer card
app.get('/time/running', async c => {
  const db = c.get('db')
  const user = c.get('user')

  const running = await db.prepare(`
    SELECT te.*, cd.title as card_title, cd.board_id as board_id
    FROM time_entries te JOIN cards cd ON cd.id = te.card_id
    WHERE te.user_id = ? AND te.ended_at IS NULL
  `).get(user.id)

  return c.json(running || null)
})

// DELETE /time/:id — apenas o próprio autor
app.delete('/time/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const entry = await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id)
  if (!entry) return c.json({ error: 'Lançamento não encontrado' }, 404)
  if (entry.user_id !== user.id) return c.json({ error: 'Sem permissão' }, 403)

  await db.prepare('DELETE FROM time_entries WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// Monta a query base de summary/export — filtros compartilhados. Só entram
// os quadros que a pessoa enxerga (mesma regra das Métricas) — antes o
// relatório somava/exportava o tempo de TODOS os quadros de todo mundo.
// Retorna null quando o boardId pedido não é visível.
async function buildFilters(db, userId, query) {
  const to = query.to || new Date().toISOString().slice(0, 10)
  const fromDefault = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from = query.from || fromDefault
  let ids = await getVisibleBoardIds(db, userId)
  if (query.boardId) {
    if (!ids.includes(query.boardId)) return null
    ids = [query.boardId]
  }
  // Sem quadro visível: filtro que não casa nada (IN () é inválido no SQLite).
  const boardFilter = ids.length
    ? `AND te.card_id IN (SELECT id FROM cards WHERE board_id IN (${ids.map(() => '?').join(',')}))`
    : 'AND 0'
  return { from, to, boardFilter, args: [from, to, ...ids] }
}

// GET /time/summary?boardId=&from=&to=
app.get('/time/summary', async c => {
  const db = c.get('db')
  const filters = await buildFilters(db, c.get('user').id, c.req.query())
  if (!filters) return c.json({ error: 'Sem acesso a este quadro' }, 403)
  const { from, to, boardFilter, args } = filters

  const totalSeconds = await db.scalar(`
    SELECT COALESCE(SUM(te.duration_seconds), 0) FROM time_entries te
    WHERE te.duration_seconds IS NOT NULL AND date(te.started_at) BETWEEN ? AND ? ${boardFilter}
  `, ...args) ?? 0

  const byUser = await db.prepare(`
    SELECT te.user_id, u.name as user_name, COALESCE(SUM(te.duration_seconds), 0) as totalSeconds
    FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.duration_seconds IS NOT NULL AND date(te.started_at) BETWEEN ? AND ? ${boardFilter}
    GROUP BY te.user_id ORDER BY totalSeconds DESC
  `).all(...args)

  const byDay = await db.prepare(`
    SELECT strftime('%Y-%m-%d', te.started_at) as date, COALESCE(SUM(te.duration_seconds), 0) as totalSeconds
    FROM time_entries te
    WHERE te.duration_seconds IS NOT NULL AND date(te.started_at) BETWEEN ? AND ? ${boardFilter}
    GROUP BY date ORDER BY date
  `).all(...args)

  return c.json({ totalSeconds, byUser, byDay })
})

// GET /time/export — CSV
app.get('/time/export', async c => {
  const db = c.get('db')
  const filters = await buildFilters(db, c.get('user').id, c.req.query())
  if (!filters) return c.json({ error: 'Sem acesso a este quadro' }, 403)
  const { from, to, boardFilter, args } = filters

  const rows = await db.prepare(`
    SELECT te.*, u.name as user_name, cd.title as card_title, b.name as board_name
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN cards cd ON cd.id = te.card_id
    JOIN boards b ON b.id = cd.board_id
    WHERE te.duration_seconds IS NOT NULL AND date(te.started_at) BETWEEN ? AND ? ${boardFilter}
    ORDER BY te.started_at
  `).all(...args)

  const headers = ['Usuário', 'Quadro', 'Cartão', 'Data', 'Duração (h:mm)', 'Observação']
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push([
      row.user_name,
      row.board_name,
      row.card_title,
      row.started_at,
      formatHoursMinutes(row.duration_seconds),
      row.note || '',
    ].map(escapeCsv).join(','))
  }
  const csv = '﻿' + lines.join('\r\n') // BOM para o Excel abrir UTF-8 corretamente

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tempo-${from}-a-${to}.csv"`,
    }
  })
})

export default app
