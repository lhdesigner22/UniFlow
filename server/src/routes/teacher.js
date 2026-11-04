import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { glpiCreateTicket, glpiTicketStatuses } from '../lib/glpiClient.js'
import {
  BUILDINGS, TICKET_KINDS, MAX_CHROMEBOOKS, MAX_DAYS_AHEAD,
  todayBrasilia, addDays, esc, describeRequest, notifyLoanEditors,
} from '../lib/teacherPortal.js'

// Portal do Professor (módulo "teacher"; o portão do worker.js já barra quem não
// tem). Cada professor só vê e mexe no que é DELE — por isso toda consulta filtra
// por user_id, e não por departamento.
//
// Plano grátis: o portal não usa tempo real nem o sininho; a situação dos chamados
// vem do GLPI no máximo a cada 5 min por chamado e no máximo 8 chamados por visita.
const app = new Hono()
app.use('*', auth)

const str = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '')
const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '')
const glpiReady = env => !!(env.GLPI_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN)

// GET /overview → { requests, tickets, buildings, kinds, today }
app.get('/overview', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  const today = todayBrasilia()
  const [requests, tickets] = await Promise.all([
    db.prepare(`
      SELECT id, building, room, use_date, start_time, end_time, quantity, notes, status, decision_note, decided_at, created_at
      FROM chromebook_requests WHERE user_id = ? AND use_date >= ?
      ORDER BY use_date DESC, start_time DESC LIMIT 30
    `).all(userId, addDays(today, -30)),
    db.prepare(`
      SELECT id, glpi_ticket_id, kind, building, room, title, glpi_status, status_checked_at, created_at
      FROM teacher_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(userId),
  ])

  // Situação dos chamados ainda abertos (5 = solucionado, 6 = fechado não mudam mais).
  const stale = tickets.filter(t => ![5, 6].includes(t.glpi_status)
    && (!t.status_checked_at || Date.now() - Date.parse(t.status_checked_at.replace(' ', 'T') + 'Z') > 5 * 60_000)).slice(0, 8)
  if (stale.length && glpiReady(c.env)) {
    try {
      const statuses = await glpiTicketStatuses(c.env, stale.map(t => t.glpi_ticket_id))
      const updates = []
      for (const t of stale) {
        const s = statuses[t.glpi_ticket_id]
        if (!s) continue
        t.glpi_status = s
        updates.push({ sql: "UPDATE teacher_tickets SET glpi_status = ?, status_checked_at = datetime('now') WHERE id = ?", args: [s, t.id] })
      }
      if (updates.length) await db.batch(updates)
    } catch (e) {
      console.error('[teacher] situação no GLPI falhou:', e.message) // mostra a última conhecida
    }
  }
  return c.json({ requests, tickets, buildings: BUILDINGS, kinds: TICKET_KINDS, today })
})

// POST /chromebook-requests { building, room, use_date, start_time, end_time, quantity, notes }
app.post('/chromebook-requests', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const today = todayBrasilia()
  const quantity = Number(b.quantity)
  const room = str(b.room, 80)
  if (!BUILDINGS[b.building]) return c.json({ error: 'Escolha o prédio.' }, 400)
  if (!room) return c.json({ error: 'Informe a sala.' }, 400)
  if (!isDate(b.use_date) || b.use_date < today) return c.json({ error: 'Escolha uma data de hoje em diante.' }, 400)
  if (b.use_date > addDays(today, MAX_DAYS_AHEAD)) return c.json({ error: `Os pedidos podem ser feitos até ${MAX_DAYS_AHEAD} dias antes.` }, 400)
  if (!isTime(b.start_time) || !isTime(b.end_time) || b.start_time >= b.end_time) return c.json({ error: 'Confira o horário: o fim precisa ser depois do início.' }, 400)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CHROMEBOOKS) return c.json({ error: `A quantidade vai de 1 a ${MAX_CHROMEBOOKS}.` }, 400)

  const open = await db.prepare("SELECT COUNT(*) AS n FROM chromebook_requests WHERE user_id = ? AND status = 'pendente'").get(user.id)
  if (open.n >= 10) return c.json({ error: 'Você já tem 10 pedidos esperando a TI. Aguarde a resposta antes de pedir mais.' }, 429)

  const row = {
    id: uuid(), building: b.building, room, use_date: b.use_date, start_time: b.start_time, end_time: b.end_time,
    quantity, notes: str(b.notes, 500), status: 'pendente',
  }
  await db.prepare(`
    INSERT INTO chromebook_requests (id, user_id, building, room, use_date, start_time, end_time, quantity, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, user.id, row.building, row.room, row.use_date, row.start_time, row.end_time, row.quantity, row.notes)
  await notifyLoanEditors(db, 'Novo pedido de Chromebooks', `${user.name}: ${describeRequest(row)}`)
  return c.json(row, 201)
})

// POST /chromebook-requests/:id/cancel — o próprio professor, antes do dia de uso.
app.post('/chromebook-requests/:id/cancel', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const r = await db.prepare('SELECT * FROM chromebook_requests WHERE id = ? AND user_id = ?').get(c.req.param('id'), user.id)
  if (!r) return c.json({ error: 'Pedido não encontrado.' }, 404)
  if (!['pendente', 'aprovada'].includes(r.status)) return c.json({ error: 'Este pedido não pode mais ser cancelado.' }, 409)
  if (r.use_date < todayBrasilia()) return c.json({ error: 'Este pedido já passou.' }, 409)
  await db.prepare("UPDATE chromebook_requests SET status = 'cancelada' WHERE id = ?").run(r.id)
  if (r.status === 'aprovada') await notifyLoanEditors(db, 'Pedido de Chromebooks cancelado', `${user.name} cancelou: ${describeRequest(r)}`)
  return c.json({ ok: true })
})

// POST /tickets { kind, building, room, description } → abre o chamado no GLPI em nome do professor.
app.post('/tickets', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const description = str(b.description, 2000)
  const room = str(b.room, 80)
  if (!TICKET_KINDS[b.kind]) return c.json({ error: 'Escolha o tipo de problema.' }, 400)
  if (!BUILDINGS[b.building]) return c.json({ error: 'Escolha o prédio.' }, 400)
  if (!description || description.length < 10) return c.json({ error: 'Descreva o problema (pelo menos 10 letras).' }, 400)
  if (!glpiReady(c.env)) return c.json({ error: 'A abertura de chamados está indisponível agora. Avise a TI.' }, 503)

  const recent = await db.prepare("SELECT COUNT(*) AS n FROM teacher_tickets WHERE user_id = ? AND created_at > datetime('now', '-1 day')").get(user.id)
  if (recent.n >= 5) return c.json({ error: 'Você já abriu 5 chamados nas últimas 24 horas. Se for urgente, procure a TI.' }, 429)

  const me = await db.prepare('SELECT name, email FROM users WHERE id = ?').get(user.id)
  const entity = await db.prepare("SELECT value FROM app_settings WHERE key = 'teacher_glpi_entity_id'").get()
  const place = `${BUILDINGS[b.building]}${room ? `, ${room}` : ''}`
  const title = `[Professor] ${TICKET_KINDS[b.kind]} — ${place}`
  const content = [
    `<p>${esc(description).replace(/\n/g, '<br>')}</p>`,
    `<p><b>Local:</b> ${esc(place)}<br><b>Professor(a):</b> ${esc(me?.name)} (${esc(me?.email)})</p>`,
    '<p><i>Aberto pelo Portal do Professor (UniFlow).</i></p>',
  ].join('')
  let created
  try {
    created = await glpiCreateTicket(c.env, { title, content, entityId: Number(entity?.value) || 4, requesterEmail: me?.email })
  } catch (e) {
    console.error('[teacher] criar chamado no GLPI falhou:', e.message)
    return c.json({ error: 'Não deu para abrir o chamado no GLPI agora. Tente de novo em alguns minutos.' }, 502)
  }
  const row = { id: uuid(), glpi_ticket_id: created.id, kind: b.kind, building: b.building, room, title, glpi_status: 1 }
  await db.prepare(`
    INSERT INTO teacher_tickets (id, user_id, glpi_ticket_id, kind, building, room, title, glpi_status, status_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(row.id, user.id, row.glpi_ticket_id, row.kind, row.building, row.room, row.title)
  return c.json(row, 201)
})

export default app
