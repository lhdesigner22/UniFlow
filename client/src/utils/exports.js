// As exportações do UniFlow em XLSX (antes: CSV). Cada função busca os dados
// crus no servidor (`/export?format=json`) e monta a planilha formatada — ver
// utils/xlsxExport.js. Rótulos e cores iguais aos das telas.
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { downloadXlsx, groupSum, dbDate, dbDateTime, dbMonth, secondsToDays } from './xlsxExport'

const author = () => useAuthStore.getState().user?.name
const br = iso => (iso ? iso.split('-').reverse().join('/') : '')
const monthName = ym => {
  const d = dbMonth(ym)
  return d ? d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, c => c.toUpperCase()) : '—'
}

// ── Tempo da equipe ────────────────────────────────────────────────────────
export async function exportTimeXlsx({ from, to, boardId, boardName }) {
  const { data } = await api.get('/time/export', { params: { from, to, ...(boardId ? { boardId } : {}), format: 'json' } })
  const rows = data.rows || []
  const subtitle = `Período: ${br(from)} a ${br(to)} · Quadro: ${boardName || 'Todos os quadros'}`
  const entries = rows.map(r => ({
    date: dbDateTime(r.started_at), user: r.user_name, board: r.board_name, card: r.card_title,
    duration: secondsToDays(r.duration_seconds), note: r.note || null,
  }))
  const byUser = groupSum(rows, r => r.user_name, { secs: r => r.duration_seconds })
    .sort((a, b) => b.secs - a.secs).map(g => ({ key: g.key, count: g.count, duration: secondsToDays(g.secs) }))
  const byBoard = groupSum(rows, r => r.board_name, { secs: r => r.duration_seconds })
    .sort((a, b) => b.secs - a.secs).map(g => ({ key: g.key, count: g.count, duration: secondsToDays(g.secs) }))
  const summaryCols = first => [
    { header: first, key: 'key', width: 36 },
    { header: 'Lançamentos', key: 'count', width: 14, type: 'int', total: 'sum' },
    { header: 'Horas', key: 'duration', width: 14, type: 'duration', total: 'sum' },
  ]

  await downloadXlsx({
    fileName: `tempo-equipe-${from}-a-${to}`,
    title: 'Tempo da equipe',
    subtitle,
    author: author(),
    sheets: [
      {
        name: 'Lançamentos',
        columns: [
          { header: 'Data', key: 'date', width: 17, type: 'datetime' },
          { header: 'Pessoa', key: 'user', width: 26 },
          { header: 'Quadro', key: 'board', width: 26 },
          { header: 'Cartão', key: 'card', width: 40, wrap: true },
          { header: 'Duração', key: 'duration', width: 12, type: 'duration', total: 'sum' },
          { header: 'Observação', key: 'note', width: 44, wrap: true },
        ],
        rows: entries,
      },
      { name: 'Por pessoa', title: 'Tempo da equipe — por pessoa', columns: summaryCols('Pessoa'), rows: byUser, tabColor: 'FF22C55E' },
      { name: 'Por quadro', title: 'Tempo da equipe — por quadro', columns: summaryCols('Quadro'), rows: byBoard, tabColor: 'FF8B5CF6' },
    ],
  })
}

// ── Solicitações de compra ─────────────────────────────────────────────────
const PURCHASE_STATUS = {
  pendente: 'Pendente', aprovado: 'Aprovado', enviada_ao_gestor: 'Enviada ao Gestor',
  reprovado: 'Reprovado', comprado: 'Comprado', entregue: 'Entregue',
}
const PURCHASE_BADGE = { Pendente: 'yellow', Aprovado: 'green', 'Enviada ao Gestor': 'blue', Reprovado: 'red', Comprado: 'purple', Entregue: 'green' }
const DECISION = { pending: 'pendente', approved: 'aprovou', rejected: 'reprovou' }

export async function exportPurchasesXlsx({ month } = {}) {
  const { data } = await api.get('/purchase-requests/export', { params: { format: 'json', ...(month ? { month } : {}) } })
  const rows = data.rows || []
  const items = rows.map(r => ({
    month: dbMonth(r.reference_month),
    item: r.item_name,
    ticket: r.ticket_number || null,
    department: r.department || null,
    location: r.location || null,
    description: r.description || null,
    qty: Number(r.quantity) || 0,
    unit: Number(r.unit_price) || 0,
    total: (Number(r.quantity) || 0) * (Number(r.unit_price) || 0),
    status: PURCHASE_STATUS[r.status] || r.status,
    approvers: (r.approvers || []).map(a => `${a.user_name} (${DECISION[a.decision] || a.decision})`).join('\n') || null,
    link: r.link_url || null,
    notes: r.notes || null,
    author: r.author_name || null,
    created: dbDateTime(r.created_at),
  }))
  const byStatus = groupSum(items, i => i.status, { qty: i => i.qty, total: i => i.total })
    .sort((a, b) => b.total - a.total)
  const byMonth = groupSum(rows, r => r.reference_month, { total: r => (Number(r.quantity) || 0) * (Number(r.unit_price) || 0) })
    .sort((a, b) => String(b.key).localeCompare(String(a.key)))
    .map(g => ({ key: dbMonth(g.key), count: g.count, total: g.total }))

  await downloadXlsx({
    fileName: month ? `solicitacoes-compra-${month}` : 'solicitacoes-compra',
    title: 'Solicitações de compra',
    subtitle: month ? `Mês de referência: ${monthName(month)}` : 'Todos os meses',
    author: author(),
    sheets: [
      {
        name: 'Solicitações',
        columns: [
          { header: 'Mês', key: 'month', width: 11, type: 'month' },
          { header: 'Item', key: 'item', width: 32, wrap: true },
          { header: 'Chamado', key: 'ticket', width: 11 },
          { header: 'Departamento', key: 'department', width: 18 },
          { header: 'Unidade/Sede', key: 'location', width: 16 },
          { header: 'Descrição', key: 'description', width: 36, wrap: true },
          { header: 'Qtd', key: 'qty', width: 7, type: 'int', total: 'sum' },
          { header: 'Valor unitário', key: 'unit', width: 15, type: 'money' },
          { header: 'Valor total', key: 'total', width: 16, type: 'money', total: 'sum' },
          { header: 'Status', key: 'status', width: 18, badge: PURCHASE_BADGE },
          { header: 'Aprovadores', key: 'approvers', width: 30, wrap: true },
          { header: 'Link', key: 'link', width: 9, type: 'link' },
          { header: 'Observação', key: 'notes', width: 30, wrap: true },
          { header: 'Cadastrado por', key: 'author', width: 22 },
          { header: 'Criado em', key: 'created', width: 17, type: 'datetime' },
        ],
        rows: items,
      },
      {
        name: 'Por status', title: 'Solicitações de compra — por status', tabColor: 'FF22C55E',
        columns: [
          { header: 'Status', key: 'key', width: 22, badge: PURCHASE_BADGE },
          { header: 'Solicitações', key: 'count', width: 14, type: 'int', total: 'sum' },
          { header: 'Quantidade de itens', key: 'qty', width: 20, type: 'int', total: 'sum' },
          { header: 'Valor total', key: 'total', width: 18, type: 'money', total: 'sum' },
        ],
        rows: byStatus,
      },
      {
        name: 'Por mês', title: 'Solicitações de compra — por mês', tabColor: 'FF8B5CF6',
        columns: [
          { header: 'Mês', key: 'key', width: 14, type: 'month' },
          { header: 'Solicitações', key: 'count', width: 14, type: 'int', total: 'sum' },
          { header: 'Valor total', key: 'total', width: 18, type: 'money', total: 'sum' },
        ],
        rows: byMonth,
      },
    ],
  })
}

// ── Empréstimo de equipamentos ─────────────────────────────────────────────
const LOAN_STATUS = { aguardando_devolucao: 'Aguardando devolução', devolvido: 'Devolvido', uso_permanente: 'Uso permanente' }
const LOAN_BADGE = { 'Aguardando devolução': 'yellow', Devolvido: 'green', 'Uso permanente': 'blue' }

export async function exportLoansXlsx() {
  const { data } = await api.get('/equipment-loans/export', { params: { format: 'json' } })
  const rows = data.rows || []
  const loans = rows.map(r => ({
    date: dbDate(r.loan_date),
    requester: r.requester_name,
    email: r.requester_email || null,
    equipment: r.equipment_model,
    patrimony: r.patrimony || null,
    building: r.building?.toUpperCase() || null,
    location: r.location || null,
    status: LOAN_STATUS[r.status] || r.status,
    returned: dbDateTime(r.returned_at),
    notes: r.notes || null,
    author: r.author_name || null,
    created: dbDateTime(r.created_at),
  }))
  const summary = groupSum(rows, r => r.building?.toUpperCase(), {
    waiting: r => r.status === 'aguardando_devolucao',
    returned: r => r.status === 'devolvido',
    permanent: r => r.status === 'uso_permanente',
  }).sort((a, b) => String(a.key).localeCompare(String(b.key))).map(g => ({ ...g, total: g.count }))
  const byEquipment = groupSum(rows, r => r.equipment_model, { waiting: r => r.status === 'aguardando_devolucao' })
    .sort((a, b) => b.count - a.count)

  await downloadXlsx({
    fileName: 'emprestimo-equipamentos',
    title: 'Empréstimo de equipamentos',
    subtitle: 'Todos os prédios (SEDE, CENTRO e G5)',
    author: author(),
    sheets: [
      {
        name: 'Empréstimos',
        columns: [
          { header: 'Data', key: 'date', width: 12, type: 'date' },
          { header: 'Solicitante', key: 'requester', width: 30 },
          { header: 'E-mail', key: 'email', width: 30 },
          { header: 'Equipamento', key: 'equipment', width: 24 },
          { header: 'Patrimônio', key: 'patrimony', width: 13 },
          { header: 'Prédio', key: 'building', width: 9 },
          { header: 'Sala/Localidade', key: 'location', width: 18 },
          { header: 'Situação', key: 'status', width: 22, badge: LOAN_BADGE, total: 'count' },
          { header: 'Devolvido em', key: 'returned', width: 17, type: 'datetime' },
          { header: 'Observação', key: 'notes', width: 32, wrap: true },
          { header: 'Registrado por', key: 'author', width: 22 },
          { header: 'Criado em', key: 'created', width: 17, type: 'datetime' },
        ],
        rows: loans,
      },
      {
        name: 'Resumo por prédio', title: 'Empréstimo de equipamentos — resumo por prédio', tabColor: 'FF22C55E',
        columns: [
          { header: 'Prédio', key: 'key', width: 14 },
          { header: 'Aguardando devolução', key: 'waiting', width: 22, type: 'int', total: 'sum' },
          { header: 'Devolvido', key: 'returned', width: 14, type: 'int', total: 'sum' },
          { header: 'Uso permanente', key: 'permanent', width: 17, type: 'int', total: 'sum' },
          { header: 'Total', key: 'total', width: 12, type: 'int', total: 'sum' },
        ],
        rows: summary,
      },
      {
        name: 'Por equipamento', title: 'Empréstimo de equipamentos — por equipamento', tabColor: 'FF8B5CF6',
        columns: [
          { header: 'Equipamento', key: 'key', width: 30 },
          { header: 'Empréstimos', key: 'count', width: 14, type: 'int', total: 'sum' },
          { header: 'Aguardando devolução', key: 'waiting', width: 22, type: 'int', total: 'sum' },
        ],
        rows: byEquipment,
      },
    ],
  })
}
