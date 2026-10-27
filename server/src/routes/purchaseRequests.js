import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { normalizeLink, isLinkError } from '../lib/safeUrl.js'
import { escapeCsv } from '../lib/csv.js'
import { createNotification } from './notifications.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Solicitação de Compra — substitui a planilha de compras. Editar/excluir o
// item é só de quem cadastrou ou super_admin. Aprovar/reprovar é só de quem
// foi escolhido como aprovador na criação (mesmo modelo de approvals.js).
// Depois de aprovado, avançar pra comprado/entregue é liberado pra qualquer
// usuário logado (quem compra/recebe nem sempre é quem pediu ou aprovou).
const app = new Hono()
app.use('*', auth)

const MANUAL_STATUSES = ['enviada_ao_gestor', 'comprado', 'entregue'] // os únicos setáveis via POST /:id/status

const LIST_COLUMNS = `
  p.id, p.item_name, p.ticket_number, p.department, p.description, p.location,
  p.quantity, p.unit_price, p.link_url, p.notes, p.status, p.reference_month,
  p.created_by, p.created_at, p.updated_at, u.name as author_name,
  p.department_id, dd.name as department_name, dd.color as department_color
`

// YYYY-MM atual, usado como padrão quando a solicitação não informa o mês
// de referência.
function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// Quem enxerga uma solicitação: o departamento dela (+ Geral), e SEMPRE quem
// participa — quem pediu e quem foi escolhido como aprovador (mesmo de outro
// departamento, senão não conseguiria decidir).
function visibilityClause(access, userId) {
  const f = departmentFilter(access, 'p.department_id')
  if (!f.sql) return { sql: '', args: [] }
  return {
    sql: ` AND ((${f.sql.slice(5)}) OR p.created_by = ? OR EXISTS (SELECT 1 FROM purchase_request_approvers pa WHERE pa.purchase_request_id = p.id AND pa.user_id = ?))`,
    args: [...f.args, userId, userId],
  }
}

async function canSeeRequest(db, access, row, userId) {
  if (canSeeDepartment(access, row.department_id) || row.created_by === userId) return true
  return !!(await db.prepare('SELECT 1 FROM purchase_request_approvers WHERE purchase_request_id = ? AND user_id = ?').get(row.id, userId))
}

async function getRequestForEdit(db, id, user, access) {
  const row = await db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id)
  if (!row || !(await canSeeRequest(db, access, row, user.id))) return { row: null, allowed: false }
  const owns = row.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, row.department_id, owns)
  return { row, allowed }
}

async function getApprovers(db, purchaseRequestId) {
  return await db.prepare(`
    SELECT pa.id, pa.user_id, pa.decision, pa.comment, pa.decided_at,
      u.name as user_name, u.avatar as user_avatar
    FROM purchase_request_approvers pa JOIN users u ON u.id = pa.user_id
    WHERE pa.purchase_request_id = ?
    ORDER BY pa.created_at
  `).all(purchaseRequestId)
}

// Aprovadores (e histórico) de VÁRIAS solicitações numa consulta só. Antes a
// lista fazia 2 consultas por solicitação, uma atrás da outra: com 21 pedidos
// eram 43 idas ao D1 (tela lenta e perto do limite de 50 do plano Free).
async function attachApproversAndLog(db, rows, { withLog = true } = {}) {
  if (!rows.length) return
  const ids = JSON.stringify(rows.map(r => r.id))
  const [approvers, logs] = await Promise.all([
    db.prepare(`
      SELECT pa.purchase_request_id, pa.id, pa.user_id, pa.decision, pa.comment, pa.decided_at,
        u.name as user_name, u.avatar as user_avatar
      FROM purchase_request_approvers pa JOIN users u ON u.id = pa.user_id
      WHERE pa.purchase_request_id IN (SELECT value FROM json_each(?))
      ORDER BY pa.created_at
    `).all(ids),
    withLog ? db.prepare(`
      SELECT l.purchase_request_id, l.id, l.status, l.comment, l.changed_by, l.created_at,
        u.name as changed_by_name, u.avatar as changed_by_avatar
      FROM purchase_request_status_log l JOIN users u ON u.id = l.changed_by
      WHERE l.purchase_request_id IN (SELECT value FROM json_each(?))
      ORDER BY l.created_at DESC
    `).all(ids) : [],
  ])
  const group = list => {
    const by = {}
    for (const { purchase_request_id, ...item } of list) (by[purchase_request_id] ||= []).push(item)
    return by
  }
  const approversBy = group(approvers)
  const logsBy = group(logs)
  for (const row of rows) {
    row.approvers = approversBy[row.id] || []
    if (withLog) row.status_log = logsBy[row.id] || []
  }
}

// Histórico de mudanças manuais de status (Enviada ao Gestor/Comprado/
// Entregue) — mais recente primeiro, pra aparecer pronto pra leitura.
async function getStatusLog(db, purchaseRequestId) {
  return await db.prepare(`
    SELECT l.id, l.status, l.comment, l.changed_by, l.created_at,
      u.name as changed_by_name, u.avatar as changed_by_avatar
    FROM purchase_request_status_log l JOIN users u ON u.id = l.changed_by
    WHERE l.purchase_request_id = ?
    ORDER BY l.created_at DESC
  `).all(purchaseRequestId)
}

// Reprovado se qualquer aprovador reprovar; aprovado só se TODOS aprovarem;
// senão continua pendente — idêntico ao computeStatus de approvals.js.
function computeApprovalStatus(approvers) {
  if (approvers.some(a => a.decision === 'rejected')) return 'reprovado'
  if (approvers.length > 0 && approvers.every(a => a.decision === 'approved')) return 'aprovado'
  return 'pendente'
}

// GET / — lista tudo (com aprovadores de cada item), mais recentes primeiro
app.get('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const vis = visibilityClause(await accessOf(c), user.id)
  const rows = await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id
    WHERE 1=1${vis.sql}
    ORDER BY p.created_at DESC
  `).all(...vis.args)

  await attachApproversAndLog(db, rows)
  for (const row of rows) row.my_decision = row.approvers.find(x => x.user_id === user.id)?.decision || null

  return c.json(rows)
})

// POST / — qualquer usuário logado pode pedir a compra de um item, mas
// precisa escolher pelo menos 1 aprovador (igual Aprovações)
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const {
    item_name, ticket_number, department, description, location,
    quantity, unit_price, link_url, notes, approver_ids, reference_month, department_id,
  } = await c.req.json()
  if (!item_name?.trim()) return c.json({ error: 'Nome do item é obrigatório' }, 400)
  const link = normalizeLink(link_url)
  if (isLinkError(link)) return c.json(link, 400)

  const approverIds = [...new Set(Array.isArray(approver_ids) ? approver_ids : [])].filter(x => x !== user.id)
  if (approverIds.length === 0) return c.json({ error: 'Escolha pelo menos um aprovador' }, 400)

  const id = uuid()
  await db.prepare(`
    INSERT INTO purchase_requests
      (id, item_name, ticket_number, department, description, location, quantity, unit_price, link_url, notes, reference_month, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, item_name.trim(),
    ticket_number?.trim() || null,
    department?.trim() || null,
    description?.trim() || null,
    location?.trim() || null,
    Number.isFinite(+quantity) && +quantity > 0 ? Math.round(+quantity) : 1,
    Number.isFinite(+unit_price) ? +unit_price : 0,
    link ?? null,
    notes?.trim() || null,
    /^\d{4}-\d{2}$/.test(reference_month) ? reference_month : currentMonth(),
    user.id,
    departmentForCreate(await accessOf(c), department_id)
  )

  for (const approverId of approverIds) {
    await db.prepare('INSERT INTO purchase_request_approvers (id, purchase_request_id, user_id) VALUES (?, ?, ?)')
      .run(uuid(), id, approverId)
    try {
      await createNotification(db, approverId, 'purchase_request', 'Nova solicitação de compra pra aprovar', `${user.name}: ${item_name.trim()}`, null)
    } catch (err) {
      console.error('Falha ao notificar aprovador:', err)
    }
  }

  const row = await db.prepare(`SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id)
  row.approvers = await getApprovers(db, id)
  row.my_decision = null
  row.status_log = []
  return c.json(row)
})

// PUT /:id — autor ou super_admin. Edita os campos do item (aprovadores não
// mudam depois de criado — mesma regra de approvals.js).
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { row, allowed } = await getRequestForEdit(db, id, user, await accessOf(c))
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { item_name, ticket_number, department, description, location, quantity, unit_price, link_url, notes, reference_month, department_id } = await c.req.json()
  const link = normalizeLink(link_url)
  if (isLinkError(link)) return c.json(link, 400)

  await db.prepare(`
    UPDATE purchase_requests SET
      item_name = ?, ticket_number = ?, department = ?, description = ?, location = ?,
      quantity = ?, unit_price = ?, link_url = ?, notes = ?, reference_month = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    item_name?.trim() || row.item_name,
    ticket_number !== undefined ? (ticket_number?.trim() || null) : row.ticket_number,
    department !== undefined ? (department?.trim() || null) : row.department,
    description !== undefined ? (description?.trim() || null) : row.description,
    location !== undefined ? (location?.trim() || null) : row.location,
    Number.isFinite(+quantity) && +quantity > 0 ? Math.round(+quantity) : row.quantity,
    Number.isFinite(+unit_price) ? +unit_price : row.unit_price,
    link !== undefined ? link : row.link_url,
    notes !== undefined ? (notes?.trim() || null) : row.notes,
    /^\d{4}-\d{2}$/.test(reference_month) ? reference_month : row.reference_month,
    departmentForUpdate(await accessOf(c), row.department_id, department_id),
    id
  )

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id)
  updated.approvers = await getApprovers(db, id)
  updated.my_decision = updated.approvers.find(x => x.user_id === user.id)?.decision || null
  updated.status_log = await getStatusLog(db, id)
  return c.json(updated)
})

// POST /:id/decide — só um aprovador designado — { decision: 'approved'|'rejected', comment }
app.post('/:id/decide', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const row = await db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404)

  const approverRow = await db.prepare('SELECT * FROM purchase_request_approvers WHERE purchase_request_id = ? AND user_id = ?').get(id, user.id)
  if (!approverRow) return c.json({ error: 'Você não é aprovador desta solicitação' }, 403)

  const { decision, comment } = await c.req.json()
  if (!['approved', 'rejected'].includes(decision)) return c.json({ error: 'decision inválida' }, 400)

  await db.prepare(`
    UPDATE purchase_request_approvers SET decision = ?, comment = ?, decided_at = datetime('now') WHERE id = ?
  `).run(decision, comment || null, approverRow.id)

  const approvers = await getApprovers(db, id)
  const newStatus = computeApprovalStatus(approvers)
  await db.prepare(`UPDATE purchase_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, id)

  try {
    const title = decision === 'approved' ? 'Solicitação de compra aprovada' : 'Solicitação de compra reprovada'
    await createNotification(db, row.created_by, 'purchase_request', title, `${user.name}: ${row.item_name}`, null)
  } catch (err) {
    console.error('Falha ao notificar solicitante:', err)
  }

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id)
  updated.approvers = approvers
  updated.my_decision = decision
  updated.status_log = await getStatusLog(db, id)
  return c.json(updated)
})

// POST /:id/status — qualquer usuário logado avança pra enviada ao
// gestor/comprado/entregue, mas só depois de aprovado (aprovar/reprovar é
// feito por /decide, não aqui)
app.post('/:id/status', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT id, status, department_id, created_by FROM purchase_requests WHERE id = ?').get(id)
  if (!row || !(await canSeeRequest(db, await accessOf(c), row, user.id))) return c.json({ error: 'Solicitação não encontrada' }, 404)

  const { status, comment } = await c.req.json()
  if (!MANUAL_STATUSES.includes(status)) return c.json({ error: 'Use aprovar/reprovar pra esse status' }, 400)
  if (!['aprovado', 'enviada_ao_gestor', 'comprado'].includes(row.status)) {
    return c.json({ error: 'Este item ainda precisa ser aprovado pelos aprovadores.' }, 400)
  }

  await db.prepare(`UPDATE purchase_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id)
  await db.prepare(`
    INSERT INTO purchase_request_status_log (id, purchase_request_id, status, comment, changed_by) VALUES (?, ?, ?, ?, ?)
  `).run(uuid(), id, status, comment?.trim() || null, user.id)

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id)
  updated.approvers = await getApprovers(db, id)
  updated.status_log = await getStatusLog(db, id)
  return c.json(updated)
})

// DELETE /:id — autor ou super_admin. Cascade nos aprovadores.
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { row, allowed } = await getRequestForEdit(db, id, user, await accessOf(c))
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  await db.batch([
    { sql: 'DELETE FROM purchase_request_approvers WHERE purchase_request_id = ?', args: [id] },
    { sql: 'DELETE FROM purchase_request_status_log WHERE purchase_request_id = ?', args: [id] },
    { sql: 'DELETE FROM purchase_requests WHERE id = ?', args: [id] },
  ])
  return c.json({ ok: true })
})

// GET /export — CSV com as mesmas colunas da tela + aprovadores, ou
// `?format=json` (dados crus pra planilha XLSX montada no navegador).
// `?month=YYYY-MM` = só aquele mês de referência (o que a tela está mostrando).
app.get('/export', async c => {
  const db = c.get('db')
  const vis = visibilityClause(await accessOf(c), c.get('user').id)
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') || '') ? c.req.query('month') : null
  const rows = await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM purchase_requests p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id
    WHERE 1=1${vis.sql}${month ? ' AND p.reference_month = ?' : ''}
    ORDER BY p.reference_month DESC, p.created_at DESC
  `).all(...vis.args, ...(month ? [month] : []))
  await attachApproversAndLog(db, rows, { withLog: false })
  if (c.req.query('format') === 'json') return c.json({ rows, month })

  const headers = ['Mês', 'Nome', 'Chamado', 'Departamento', 'Descrição', 'Unidade/Sede', 'Qtd', 'Valor Unitário', 'Valor Total', 'Link', 'Observação', 'Status', 'Aprovador(es)', 'Cadastrado por', 'Criado em']
  const lines = [headers.map(escapeCsv).join(',')]
  for (const r of rows) {
    lines.push([
      r.reference_month, r.item_name, r.ticket_number, r.department, r.description, r.location,
      r.quantity, r.unit_price.toFixed(2).replace('.', ','), (r.quantity * r.unit_price).toFixed(2).replace('.', ','),
      r.link_url, r.notes, r.status,
      r.approvers.map(a => `${a.user_name} (${a.decision})`).join('; '),
      r.author_name, r.created_at,
    ].map(escapeCsv).join(','))
  }
  const csv = '﻿' + lines.join('\r\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="solicitacoes-compra.csv"',
    },
  })
})

export default app
