import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { createNotification } from './notifications.js'

const app = new Hono()
app.use('*', auth)

async function logActivity(db, demandId, userId, action, details) {
  await db.prepare('INSERT INTO demand_activities (id, demand_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), demandId, userId, action, details)
}

// Query base reaproveitada por POST / (retorno), GET /:id e PUT /:id (retorno)
const detailQuery = `
  SELECT dm.*, d.name as department_name, d.color as department_color,
         au.name as assigned_to_name, cu.name as created_by_name
  FROM demands dm
  LEFT JOIN departments d ON d.id = dm.department_id
  LEFT JOIN users au ON au.id = dm.assigned_to
  LEFT JOIN users cu ON cu.id = dm.created_by
  WHERE dm.id = ?
`

// GET / — registro compartilhado, visível pra qualquer usuário logado (sem
// filtro de visibilidade por setor/pipe como havia em cards.js).
app.get('/', async c => {
  const db = c.get('db')
  const { type, status, department_id, month, q } = c.req.query()

  const conditions = []
  const args = []
  if (type) { conditions.push('dm.type = ?'); args.push(type) }
  if (status) { conditions.push('dm.status = ?'); args.push(status) }
  if (department_id) { conditions.push('dm.department_id = ?'); args.push(department_id) }
  if (month) { conditions.push("strftime('%Y-%m', dm.created_at) = ?"); args.push(month) }
  if (q) { conditions.push('dm.title LIKE ?'); args.push(`%${q}%`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await db.prepare(`
    SELECT dm.*, d.name as department_name, d.color as department_color,
           au.name as assigned_to_name, cu.name as created_by_name
    FROM demands dm
    LEFT JOIN departments d ON d.id = dm.department_id
    LEFT JOIN users au ON au.id = dm.assigned_to
    LEFT JOIN users cu ON cu.id = dm.created_by
    ${where}
    ORDER BY dm.created_at DESC
  `).all(...args)

  return c.json(rows)
})

// GET /kpis — precisa vir ANTES de GET /:id pra não ser capturado como :id='kpis'
app.get('/kpis', async c => {
  const db = c.get('db')
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7)

  const totalsRow = await db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN type='chamado' THEN 1 ELSE 0 END) as chamados,
           SUM(CASE WHEN type='evento' THEN 1 ELSE 0 END) as eventos,
           SUM(CASE WHEN status='aberto' THEN 1 ELSE 0 END) as abertos,
           SUM(CASE WHEN status='em_andamento' THEN 1 ELSE 0 END) as em_andamento,
           SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) as concluidos,
           SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END) as cancelados
    FROM demands WHERE strftime('%Y-%m', created_at) = ?
  `).get(month)

  const totals = {
    total: totalsRow?.total ?? 0,
    chamados: totalsRow?.chamados ?? 0,
    eventos: totalsRow?.eventos ?? 0,
    abertos: totalsRow?.abertos ?? 0,
    em_andamento: totalsRow?.em_andamento ?? 0,
    concluidos: totalsRow?.concluidos ?? 0,
    cancelados: totalsRow?.cancelados ?? 0,
  }

  const byDepartment = await db.prepare(`
    SELECT d.id as department_id, d.name as department_name, d.color as department_color,
           COUNT(dm.id) as total,
           SUM(CASE WHEN dm.status='concluido' THEN 1 ELSE 0 END) as concluidos
    FROM departments d
    LEFT JOIN demands dm ON dm.department_id = d.id AND strftime('%Y-%m', dm.created_at) = ?
    GROUP BY d.id ORDER BY total DESC
  `).all(month)

  const completionRate = totals.total > 0
    ? Math.round((totals.concluidos / totals.total) * 1000) / 10
    : 0

  const avgRaw = await db.scalar(`
    SELECT AVG(julianday(completed_at) - julianday(created_at)) FROM demands
    WHERE strftime('%Y-%m', created_at) = ? AND completed_at IS NOT NULL
  `, month)
  const avgResolutionDays = avgRaw != null ? Math.round(avgRaw * 10) / 10 : null

  // Últimos 6 meses incluindo o mês solicitado, do mais antigo pro mais recente.
  // new Date() aqui é seguro: roda por requisição dentro do handler do Worker,
  // não em algo que precise ser determinístico/replayable (ex: Workflow).
  const [y, m] = month.split('-').map(Number)
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  const monthlyTrend = []
  for (const mo of months) {
    const row = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) as concluidos
      FROM demands WHERE strftime('%Y-%m', created_at) = ?
    `).get(mo)
    const total = row?.total ?? 0
    const concluidos = row?.concluidos ?? 0
    monthlyTrend.push({
      month: mo,
      total,
      concluidos,
      completionRate: total > 0 ? Math.round((concluidos / total) * 1000) / 10 : 0,
    })
  }

  const upcomingEvents = await db.prepare(`
    SELECT dm.*, d.name as department_name, d.color as department_color
    FROM demands dm
    LEFT JOIN departments d ON d.id = dm.department_id
    WHERE dm.type = 'evento' AND dm.event_date IS NOT NULL
      AND strftime('%Y-%m', dm.event_date) = ? AND dm.status != 'cancelado'
    ORDER BY dm.event_date
  `).all(month)

  return c.json({ month, totals, byDepartment, completionRate, avgResolutionDays, monthlyTrend, upcomingEvents })
})

// GET /export — também precisa vir ANTES de GET /:id
app.get('/export', async c => {
  const db = c.get('db')
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7)

  const rows = await db.prepare(`
    SELECT dm.*, d.name as department_name, au.name as assigned_to_name
    FROM demands dm
    LEFT JOIN departments d ON d.id = dm.department_id
    LEFT JOIN users au ON au.id = dm.assigned_to
    WHERE strftime('%Y-%m', dm.created_at) = ?
    ORDER BY dm.created_at
  `).all(month)

  const escapeCsv = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const headers = ['Tipo', 'Título', 'Setor', 'Status', 'Prioridade', 'Responsável', 'Prazo/Data do evento', 'Criado em', 'Concluído em']
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push([
      row.type,
      row.title,
      row.department_name || '',
      row.status,
      row.priority || '',
      row.assigned_to_name || '',
      row.due_date || row.event_date || '',
      row.created_at,
      row.completed_at || '',
    ].map(escapeCsv).join(','))
  }
  const csv = '﻿' + lines.join('\r\n') // BOM para o Excel abrir UTF-8 corretamente

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="demandas-${month}.csv"`,
    }
  })
})

app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { type, title, description, department_id, priority, due_date, event_date, location, assigned_to } = await c.req.json()

  if (!title) return c.json({ error: 'Título é obrigatório' }, 400)
  if (type === 'chamado' && !department_id) return c.json({ error: 'Setor de destino é obrigatório para chamados' }, 400)
  if (type === 'evento' && !event_date) return c.json({ error: 'Data do evento é obrigatória' }, 400)

  const id = uuid()
  await db.prepare(`
    INSERT INTO demands (id, type, title, description, department_id, status, priority, created_by, assigned_to, due_date, event_date, location)
    VALUES (?, ?, ?, ?, ?, 'aberto', ?, ?, ?, ?, ?, ?)
  `).run(id, type, title, description || null, department_id || null, priority || null, user.id, assigned_to || null, due_date || null, event_date || null, location || null)

  await logActivity(db, id, user.id, 'created', 'Demanda criada')

  try {
    if (type === 'chamado' && department_id) {
      const deptUsers = await db.prepare('SELECT id FROM users WHERE department_id = ?').all(department_id)
      for (const u of deptUsers) {
        if (u.id === user.id) continue
        await createNotification(db, u.id, 'chamado', 'Novo chamado para seu setor', title, null)
      }
    }
    if (assigned_to) {
      await createNotification(db, assigned_to, 'demanda', 'Você foi designado para uma demanda', title, null)
    }
  } catch (err) {
    console.error('Falha ao notificar criação de demanda:', err)
  }

  return c.json(await db.prepare(detailQuery).get(id))
})

app.get('/:id', async c => {
  const db = c.get('db')
  const demand = await db.prepare(detailQuery).get(c.req.param('id'))
  if (!demand) return c.json({ error: 'Demanda não encontrada' }, 404)
  demand.comments = await db.prepare(`
    SELECT dc.*, u.name as user_name, u.avatar FROM demand_comments dc
    JOIN users u ON u.id = dc.user_id WHERE dc.demand_id = ? ORDER BY dc.created_at
  `).all(demand.id)
  demand.activities = await db.prepare(`
    SELECT da.*, u.name as user_name FROM demand_activities da
    JOIN users u ON u.id = da.user_id WHERE da.demand_id = ? ORDER BY da.created_at DESC LIMIT 50
  `).all(demand.id)
  return c.json(demand)
})

app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await db.prepare('SELECT * FROM demands WHERE id = ?').get(id)
  if (!existing) return c.json({ error: 'Demanda não encontrada' }, 404)

  const body = await c.req.json()
  const { title, description, department_id, status, priority, assigned_to, due_date, event_date, location } = body

  const newTitle = title ?? existing.title
  const newDescription = description !== undefined ? description : existing.description
  const newDepartmentId = department_id !== undefined ? department_id : existing.department_id
  const newStatus = status ?? existing.status
  const newPriority = priority !== undefined ? priority : existing.priority
  const newAssignedTo = assigned_to !== undefined ? assigned_to : existing.assigned_to
  const newDueDate = due_date !== undefined ? due_date : existing.due_date
  const newEventDate = event_date !== undefined ? event_date : existing.event_date
  const newLocation = location !== undefined ? location : existing.location

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const statusChanged = newStatus !== existing.status

  let completedAt = existing.completed_at
  if (statusChanged && newStatus === 'concluido') {
    completedAt = now
  } else if (statusChanged && existing.status === 'concluido' && newStatus !== 'concluido') {
    completedAt = null
  }

  const dateChanged = newDueDate !== existing.due_date || newEventDate !== existing.event_date
  const dueAlerted = dateChanged ? 0 : existing.due_alerted

  await db.prepare(`
    UPDATE demands SET title=?, description=?, department_id=?, status=?, priority=?, assigned_to=?,
      due_date=?, event_date=?, location=?, due_alerted=?, completed_at=?, updated_at=?
    WHERE id=?
  `).run(newTitle, newDescription, newDepartmentId, newStatus, newPriority, newAssignedTo,
         newDueDate, newEventDate, newLocation, dueAlerted, completedAt, now, id)

  if (statusChanged) {
    await logActivity(db, id, user.id, 'status_changed', `De '${existing.status}' para '${newStatus}'`)
    if (newStatus === 'concluido') {
      await logActivity(db, id, user.id, 'concluded', 'Demanda concluída')
    }
  }

  if (newAssignedTo && newAssignedTo !== existing.assigned_to) {
    try {
      await createNotification(db, newAssignedTo, 'demanda', 'Você foi designado para uma demanda', newTitle, null)
    } catch (err) {
      console.error('Falha ao notificar novo responsável:', err)
    }
  }

  return c.json(await db.prepare(detailQuery).get(id))
})

app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const demand = await db.prepare('SELECT created_by, assigned_to FROM demands WHERE id = ?').get(id)
  if (!demand) return c.json({ error: 'Demanda não encontrada' }, 404)

  const requester = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(user.id)
  const allowed = user.id === demand.created_by || user.id === demand.assigned_to || requester?.system_role === 'super_admin'
  if (!allowed) return c.json({ error: 'Sem permissão para excluir esta demanda.' }, 403)

  await db.prepare('DELETE FROM demand_comments WHERE demand_id = ?').run(id)
  await db.prepare('DELETE FROM demand_activities WHERE demand_id = ?').run(id)
  await db.prepare('DELETE FROM demands WHERE id = ?').run(id)
  return c.json({ ok: true })
})

app.post('/:id/comments', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const demandId = c.req.param('id')
  const { content } = await c.req.json()
  if (!content) return c.json({ error: 'Conteúdo obrigatório' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO demand_comments (id, demand_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(id, demandId, user.id, content)
  await logActivity(db, demandId, user.id, 'commented', content.substring(0, 80))
  const comment = await db.prepare(`
    SELECT dc.*, u.name as user_name, u.avatar FROM demand_comments dc
    JOIN users u ON u.id = dc.user_id WHERE dc.id = ?
  `).get(id)

  try {
    const demand = await db.prepare('SELECT created_by, assigned_to FROM demands WHERE id = ?').get(demandId)
    const targets = new Set()
    if (demand?.created_by) targets.add(demand.created_by)
    if (demand?.assigned_to) targets.add(demand.assigned_to)
    targets.delete(user.id)
    for (const targetId of targets) {
      await createNotification(db, targetId, 'comentario', 'Novo comentário', content.substring(0, 80), null)
    }
  } catch (err) {
    console.error('Falha ao notificar comentário de demanda:', err)
  }

  return c.json(comment)
})

app.delete('/:id/comments/:commentId', async c => {
  const db = c.get('db')
  const user = c.get('user')
  await db.prepare('DELETE FROM demand_comments WHERE id = ? AND user_id = ?').run(c.req.param('commentId'), user.id)
  return c.json({ ok: true })
})

export default app
