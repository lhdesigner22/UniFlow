import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { sendLoanDeadlineEmail, sendLoanQuickMessage, DEADLINE_PERIODS } from '../lib/loanDeadlineEmail.js'
import { isAllowedLoanEmail, LOAN_EMAIL_ERROR } from '../lib/loanEmailDomains.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Empréstimo de Equipamentos — qualquer usuário logado pode registrar um
// empréstimo (mesmo espírito de purchaseRequests.js: log operacional do dia
// a dia, não uma área administrativa). Editar/excluir é só de quem
// cadastrou ou super_admin; mudar a situação (Aguardando devolução/
// Devolvido/Uso Permanente) é liberado pra qualquer usuário logado, já que
// quem devolve o equipamento nem sempre é quem registrou o empréstimo.
const app = new Hono()
app.use('*', auth)

const STATUSES = ['aguardando_devolucao', 'devolvido', 'uso_permanente']
const BUILDINGS = ['sede', 'centro', 'g5']

const LIST_COLUMNS = `
  e.id, e.requester_name, e.requester_email, e.equipment_model, e.patrimony,
  e.building, e.location, e.notes, e.status, e.loan_date, e.returned_at,
  e.equipment_inventory_id, e.created_by, e.created_at, e.updated_at, u.name as author_name,
  e.department_id, dd.name as department_name, dd.color as department_color
`

// Se veio um item do inventário, confirma que existe, é do mesmo prédio e
// ainda não está emprestado — evita duas pessoas "reservarem" o mesmo
// Chromebook ao mesmo tempo.
async function resolveInventoryItem(db, inventoryId, building, ignoreLoanId, access) {
  if (!inventoryId) return { item: null, error: null }
  const item = await db.prepare('SELECT * FROM equipment_inventory WHERE id = ?').get(inventoryId)
  if (!item || (access && !canSeeDepartment(access, item.department_id))) return { item: null, error: 'Item do inventário não encontrado' }
  if (item.building !== building) return { item: null, error: 'Item do inventário é de outro prédio' }
  const activeLoan = await db.prepare(`
    SELECT id FROM equipment_loans WHERE equipment_inventory_id = ? AND status = 'aguardando_devolucao' AND id != ?
  `).get(inventoryId, ignoreLoanId || '')
  if (activeLoan) return { item: null, error: 'Esse item já está emprestado no momento — escolha outro ou recarregue a lista.' }
  return { item, error: null }
}

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

async function getLoanForEdit(db, id, user, access) {
  const row = await db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id)
  // Empréstimo de outro departamento é como se não existisse pra quem não o enxerga.
  if (!row || !canSeeDepartment(access, row.department_id)) return { row: null, allowed: false }
  const owns = row.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, row.department_id, owns)
  return { row, allowed }
}

// GET /?building=sede|centro|g5 — lista, mais recentes primeiro
app.get('/', async c => {
  const db = c.get('db')
  const building = c.req.query('building')

  let sql = `SELECT ${LIST_COLUMNS} FROM equipment_loans e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN departments dd ON dd.id = e.department_id WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'e.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (BUILDINGS.includes(building)) { sql += ' AND e.building = ?'; args.push(building) }
  sql += ' ORDER BY e.loan_date DESC, e.created_at DESC'

  return c.json(await db.prepare(sql).all(...args))
})

// POST / — qualquer usuário logado registra um empréstimo
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { requester_name, requester_email, equipment_model, patrimony, building, location, notes, loan_date, status, equipment_inventory_id, extra_items, send_email, deadline_period, department_id } = await c.req.json()
  if (!requester_name?.trim()) return c.json({ error: 'Nome do solicitante é obrigatório' }, 400)
  if (!equipment_model?.trim()) return c.json({ error: 'Equipamento é obrigatório' }, 400)
  if (!BUILDINGS.includes(building)) return c.json({ error: 'Prédio inválido (use sede, centro ou g5)' }, 400)
  if (requester_email?.trim() && !isAllowedLoanEmail(requester_email)) return c.json({ error: LOAN_EMAIL_ERROR }, 400)
  const access = await accessOf(c)

  // Vários equipamentos na mesma reserva: o primeiro vem nos campos de
  // sempre, os demais em `extra_items`. Cada equipamento vira uma linha própria
  // (cada um pode ser devolvido em separado). Valida TUDO antes de gravar
  // qualquer coisa, pra não ficar um empréstimo pela metade.
  const items = [{ equipment_model, patrimony, equipment_inventory_id }]
  if (Array.isArray(extra_items)) {
    for (const it of extra_items.slice(0, 30)) {
      if (!it?.equipment_model?.trim()) return c.json({ error: 'Todos os equipamentos adicionados precisam ter o nome do equipamento' }, 400)
      items.push(it)
    }
  }
  const seenInventory = new Set()
  const resolved = []
  for (const it of items) {
    if (it.equipment_inventory_id) {
      if (seenInventory.has(it.equipment_inventory_id)) return c.json({ error: 'O mesmo item do inventário foi escolhido duas vezes' }, 400)
      seenInventory.add(it.equipment_inventory_id)
    }
    const { item: invItem, error: invError } = await resolveInventoryItem(db, it.equipment_inventory_id, building, undefined, access)
    if (invError) return c.json({ error: invError }, 400)
    resolved.push(invItem)
  }

  const finalStatus = STATUSES.includes(status) ? status : 'aguardando_devolucao'
  const loanDepartment = departmentForCreate(access, department_id)
  const ids = items.map(() => uuid())
  await db.batch(items.map((it, i) => ({
    sql: `
      INSERT INTO equipment_loans
        (id, requester_name, requester_email, equipment_model, patrimony, building, location, notes, status, loan_date, returned_at, equipment_inventory_id, created_by, department_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      ids[i], requester_name.trim(),
      requester_email?.trim() || null,
      it.equipment_model.trim(),
      it.patrimony?.trim() || null,
      building,
      location?.trim() || null,
      notes?.trim() || null,
      finalStatus,
      loan_date?.trim() || new Date().toISOString().slice(0, 10),
      finalStatus === 'devolvido' ? new Date().toISOString() : null,
      resolved[i]?.id || null,
      user.id,
      loanDepartment,
    ],
  })))

  const rows = []
  for (const id of ids) {
    rows.push(await db.prepare(`SELECT ${LIST_COLUMNS} FROM equipment_loans e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN departments dd ON dd.id = e.department_id WHERE e.id = ?`).get(id))
  }
  // E-mail de prazo de devolução ao solicitante (manhã até 10h / noite até 22h),
  // um por reserva — só se o responsável deixou marcado e há e-mail. Roda em
  // segundo plano (waitUntil) pra não atrasar a resposta.
  let emailQueued = false
  if (send_email && requester_email?.trim() && finalStatus === 'aguardando_devolucao' && DEADLINE_PERIODS.includes(deadline_period)) {
    emailQueued = true
    c.executionCtx.waitUntil(sendLoanDeadlineEmail(c.env, db, {
      to: requester_email.trim(), requesterName: requester_name.trim(), period: deadline_period, loans: rows, loanId: ids[0],
    }))
  }

  // Compatível com o formato antigo (um objeto); os adicionais vão em `extras`.
  return c.json({ ...rows[0], extras: rows.slice(1), email_queued: emailQueued })
})

// PUT /:id — autor ou super_admin
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { row, allowed } = await getLoanForEdit(db, id, user, await accessOf(c))
  if (!row) return c.json({ error: 'Empréstimo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { requester_name, requester_email, equipment_model, patrimony, building, location, notes, loan_date, equipment_inventory_id, department_id } = await c.req.json()
  const access = await accessOf(c)
  const finalBuilding = BUILDINGS.includes(building) ? building : row.building
  // Só valida se o e-mail foi ALTERADO — empréstimos antigos com e-mail que hoje
  // não é permitido continuam editáveis (trocar a sala, por ex.) sem travar.
  if (requester_email?.trim() && requester_email.trim() !== row.requester_email && !isAllowedLoanEmail(requester_email))
    return c.json({ error: LOAN_EMAIL_ERROR }, 400)

  const nextInventoryId = equipment_inventory_id !== undefined ? equipment_inventory_id : row.equipment_inventory_id
  if (nextInventoryId !== row.equipment_inventory_id) {
    const { item: invItem, error: invError } = await resolveInventoryItem(db, nextInventoryId, finalBuilding, id, access)
    if (invError) return c.json({ error: invError }, 400)
    row.equipment_inventory_id = invItem?.id || null
  }

  await db.prepare(`
    UPDATE equipment_loans SET
      requester_name = ?, requester_email = ?, equipment_model = ?, patrimony = ?,
      building = ?, location = ?, notes = ?, loan_date = ?, equipment_inventory_id = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    requester_name?.trim() || row.requester_name,
    requester_email !== undefined ? (requester_email?.trim() || null) : row.requester_email,
    equipment_model?.trim() || row.equipment_model,
    patrimony !== undefined ? (patrimony?.trim() || null) : row.patrimony,
    finalBuilding,
    location !== undefined ? (location?.trim() || null) : row.location,
    notes !== undefined ? (notes?.trim() || null) : row.notes,
    loan_date?.trim() || row.loan_date,
    row.equipment_inventory_id,
    departmentForUpdate(access, row.department_id, department_id),
    id
  )

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM equipment_loans e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN departments dd ON dd.id = e.department_id WHERE e.id = ?`).get(id)
  return c.json(updated)
})

// POST /:id/status — qualquer usuário logado (quem devolve nem sempre é
// quem registrou) — { status: 'aguardando_devolucao'|'devolvido'|'uso_permanente' }
app.post('/:id/status', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT status, department_id FROM equipment_loans WHERE id = ?').get(id)
  if (!row || !canSeeDepartment(await accessOf(c), row.department_id)) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const { status } = await c.req.json()
  if (!STATUSES.includes(status)) return c.json({ error: 'Situação inválida' }, 400)

  await db.prepare(`
    UPDATE equipment_loans SET status = ?, returned_at = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, status === 'devolvido' ? new Date().toISOString() : null, id)

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM equipment_loans e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN departments dd ON dd.id = e.department_id WHERE e.id = ?`).get(id)
  return c.json(updated)
})

// GET /:id/messages — histórico das mensagens rápidas enviadas pra esse empréstimo
app.get('/:id/messages', async c => {
  const db = c.get('db')
  const loanRow = await db.prepare('SELECT department_id FROM equipment_loans WHERE id = ?').get(c.req.param('id'))
  if (!loanRow || !canSeeDepartment(await accessOf(c), loanRow.department_id)) return c.json([])
  const rows = await db.prepare(`
    SELECT m.id, m.to_email, m.message, m.status, m.error, m.created_at, u.name as sent_by_name
    FROM equipment_loan_messages m LEFT JOIN users u ON u.id = m.sent_by
    WHERE m.loan_id = ? ORDER BY m.created_at DESC LIMIT 50
  `).all(c.req.param('id'))
  return c.json(rows)
})

// POST /:id/message — { message, to? } manda uma mensagem rápida por e-mail ao
// solicitante. Qualquer usuário logado (quem cobra a devolução nem sempre é
// quem registrou). Se o empréstimo não tinha e-mail e veio `to`, guarda no
// empréstimo pra próxima vez.
app.post('/:id/message', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const loan = await db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id)
  if (!loan || !canSeeDepartment(await accessOf(c), loan.department_id)) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const { message, to } = await c.req.json()
  const text = message?.trim()
  if (!text) return c.json({ error: 'Escreva a mensagem' }, 400)
  if (text.length > 2000) return c.json({ error: 'Mensagem muito longa (máx. 2000 caracteres)' }, 400)

  // Se o e-mail guardado no empréstimo não é permitido (ex: conta de aluno),
  // não envia pra ele — pede um válido em `to`.
  const email = (to?.trim() || (isAllowedLoanEmail(loan.requester_email) ? loan.requester_email : '') || '').trim()
  if (!email) return c.json({ error: loan.requester_email ? LOAN_EMAIL_ERROR : 'E-mail do solicitante ausente' }, 400)
  if (!isAllowedLoanEmail(email)) return c.json({ error: LOAN_EMAIL_ERROR }, 400)
  if (!isAllowedLoanEmail(loan.requester_email)) {
    await db.prepare("UPDATE equipment_loans SET requester_email = ?, updated_at = datetime('now') WHERE id = ?").run(email, id)
  }

  const msgId = uuid()
  await db.prepare('INSERT INTO equipment_loan_messages (id, loan_id, to_email, message, sent_by) VALUES (?, ?, ?, ?, ?)')
    .run(msgId, id, email, text, user.id)

  const result = await sendLoanQuickMessage(c.env, db, { to: email, requesterName: loan.requester_name, loan, message: text, loanId: id })
  await db.prepare('UPDATE equipment_loan_messages SET status = ?, error = ? WHERE id = ?')
    .run(result.ok ? 'sent' : 'failed', result.ok ? null : result.error, msgId)

  if (!result.ok) return c.json({ error: result.error }, 502)
  return c.json({ ok: true })
})

// DELETE /:id — autor ou super_admin
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { row, allowed } = await getLoanForEdit(db, id, user, await accessOf(c))
  if (!row) return c.json({ error: 'Empréstimo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  await db.prepare('DELETE FROM equipment_loans WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// GET /export — CSV
app.get('/export', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'e.department_id')
  const rows = await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM equipment_loans e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN departments dd ON dd.id = e.department_id
    WHERE 1=1${dept.sql}
    ORDER BY e.loan_date DESC, e.created_at DESC
  `).all(...dept.args)

  const STATUS_LABEL = { aguardando_devolucao: 'Aguardando devolução', devolvido: 'Devolvido', uso_permanente: 'Uso Permanente' }
  const escapeCsv = v => {
    const str = String(v ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const headers = ['Data', 'Solicitante', 'Email', 'Equipamento', 'Patrimônio', 'Prédio', 'Sala/Localidade', 'Observação', 'Situação', 'Devolvido em', 'Cadastrado por', 'Criado em']
  const lines = [headers.map(escapeCsv).join(',')]
  for (const r of rows) {
    lines.push([
      r.loan_date, r.requester_name, r.requester_email, r.equipment_model, r.patrimony,
      r.building?.toUpperCase(), r.location, r.notes, STATUS_LABEL[r.status] || r.status, r.returned_at, r.author_name, r.created_at,
    ].map(escapeCsv).join(','))
  }
  const csv = '﻿' + lines.join('\r\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="emprestimo-equipamentos.csv"',
    },
  })
})

export default app
