import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { getVisibleBoardIds } from '../lib/boardAccess.js'

const app = new Hono()
app.use('*', auth)

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

// GET /summary?from=&to=&boardId= — visão "estilo Planner": quantas tarefas
// foram concluídas, por quem e em qual quadro, no período. Escopo = os
// mesmos quadros que o usuário já enxerga em GET /boards (owner/membro, ou
// — pra Super Admin com departamento — todos os quadros do departamento
// dele, ver lib/boardAccess.js). Datas em `created_at`/`completed_at` (texto
// 'YYYY-MM-DD HH:MM:SS' em UTC) — comparação lexicográfica funciona porque
// o formato é fixo.
app.get('/summary', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const boardIdFilter = c.req.query('boardId') || null

  const to = c.req.query('to') || isoDate(new Date())
  const from = c.req.query('from') || isoDate(new Date(new Date(to).getTime() - 29 * 86400000))

  let visibleIds = await getVisibleBoardIds(db, user.id)
  if (boardIdFilter) {
    if (!visibleIds.includes(boardIdFilter)) return c.json({ error: 'Sem acesso a este quadro' }, 403)
    visibleIds = [boardIdFilter]
  }

  const empty = () => c.json({
    from, to,
    totals: { total: 0, completed: 0, inProgress: 0, notStarted: 0, completionRate: 0, boardsCount: visibleIds.length, overdue: 0 },
    byUser: [], byBoard: [], completedOverTime: [], overdueByBoard: [],
  })
  if (visibleIds.length === 0) return empty()

  const ph = visibleIds.map(() => '?').join(',')

  const totalsRow = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN progress = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN progress = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN progress IS NULL OR progress = 'not_started' THEN 1 ELSE 0 END) as not_started
    FROM cards
    WHERE board_id IN (${ph}) AND archived = 0
      AND created_at >= ? AND created_at < datetime(?, '+1 day')
  `).get(...visibleIds, from, to)

  const total = totalsRow?.total || 0
  const completed = totalsRow?.completed || 0
  const totals = {
    total,
    completed,
    inProgress: totalsRow?.in_progress || 0,
    notStarted: totalsRow?.not_started || 0,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    boardsCount: visibleIds.length,
  }

  // Por pessoa — conta por MEMBRO do cartão (card_members); um cartão com
  // vários responsáveis conta pra cada um, igual ao "quem realizou" pedido.
  const byUser = await db.prepare(`
    SELECT u.id as user_id, u.name as user_name, COUNT(*) as completed
    FROM cards cd
    JOIN card_members cm ON cm.card_id = cd.id
    JOIN users u ON u.id = cm.user_id
    WHERE cd.board_id IN (${ph}) AND cd.archived = 0 AND cd.progress = 'completed'
      AND cd.completed_at >= ? AND cd.completed_at < datetime(?, '+1 day')
    GROUP BY u.id
    ORDER BY completed DESC
  `).all(...visibleIds, from, to)

  // Por quadro — total criado no período vs. concluído (LEFT JOIN pra
  // quadros sem nenhum cartão no período ainda aparecerem, zerados).
  const byBoard = await db.prepare(`
    SELECT b.id as board_id, b.name as board_name, b.color as board_color,
      COUNT(cd.id) as total,
      SUM(CASE WHEN cd.progress = 'completed' THEN 1 ELSE 0 END) as completed
    FROM boards b
    LEFT JOIN cards cd ON cd.board_id = b.id AND cd.archived = 0
      AND cd.created_at >= ? AND cd.created_at < datetime(?, '+1 day')
    WHERE b.id IN (${ph})
    GROUP BY b.id
    ORDER BY total DESC
  `).all(from, to, ...visibleIds)

  const completedOverTime = await db.prepare(`
    SELECT date(completed_at) as date, COUNT(*) as completed
    FROM cards
    WHERE board_id IN (${ph}) AND archived = 0 AND progress = 'completed'
      AND completed_at >= ? AND completed_at < datetime(?, '+1 day')
    GROUP BY date(completed_at)
    ORDER BY date
  `).all(...visibleIds, from, to)

  // Atrasados — estado ATUAL (prazo vencido e ainda não concluído), não
  // filtrado pelo período de criação: não faz sentido um card atrasado
  // "sumir" do gráfico só porque foi criado fora do intervalo escolhido.
  const overdueByBoard = await db.prepare(`
    SELECT b.id as board_id, b.name as board_name, b.color as board_color, COUNT(cd.id) as overdue
    FROM boards b
    JOIN cards cd ON cd.board_id = b.id AND cd.archived = 0 AND cd.progress != 'completed'
      AND cd.due_date IS NOT NULL AND cd.due_date < date('now')
    WHERE b.id IN (${ph})
    GROUP BY b.id
    ORDER BY overdue DESC
  `).all(...visibleIds)

  totals.overdue = overdueByBoard.reduce((sum, b) => sum + (b.overdue || 0), 0)

  return c.json({
    from, to, totals,
    byUser: byUser.map(u => ({ ...u, completed: u.completed || 0 })),
    byBoard: byBoard.map(b => ({ ...b, total: b.total || 0, completed: b.completed || 0 })),
    completedOverTime,
    overdueByBoard: overdueByBoard.map(b => ({ ...b, overdue: b.overdue || 0 })),
  })
})

export default app
