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

// `onlyApproved`: só as que estão com status Aprovado (prontas pra comprar).
export async function exportPurchasesXlsx({ month, onlyApproved = false } = {}) {
  const { data } = await api.get('/purchase-requests/export', { params: { format: 'json', ...(month ? { month } : {}) } })
  const rows = (data.rows || []).filter(r => !onlyApproved || r.status === 'aprovado')
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
    fileName: `solicitacoes-compra${onlyApproved ? '-aprovadas' : ''}${month ? `-${month}` : ''}`,
    title: onlyApproved ? 'Solicitações de compra aprovadas' : 'Solicitações de compra',
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
      !onlyApproved && {
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
    ].filter(Boolean),
  })
}

// ── Incidentes Laboratórios ────────────────────────────────────────────────
const INC_BUILDING = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }
const INC_CATEGORY = { maquina: 'Máquina com defeito', sinistro: 'Sinistro / dano', projecao: 'Projeção / TV', organizacao: 'Bagunça / organização', rede: 'Rede / internet', outro: 'Outro' }
const INC_SEVERITY = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' }
const INC_STATUS = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido' }
const INC_SEVERITY_BADGE = { Baixa: 'gray', Média: 'yellow', Alta: 'red', Crítica: 'red' }
const INC_STATUS_BADGE = { Aberto: 'yellow', 'Em andamento': 'blue', Resolvido: 'green' }
// occurred_at já é horário de Brasília ('YYYY-MM-DDTHH:MM') → Date "local" pro Excel
const localDateTime = v => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null
}

export async function exportLabIncidentsXlsx({ building } = {}) {
  const { data } = await api.get('/lab-incidents/export', { params: building ? { building } : {} })
  const rows = data.rows || []
  const items = rows.map(r => ({
    occurred: localDateTime(r.occurred_at),
    building: INC_BUILDING[r.building] || r.building,
    lab: r.lab,
    category: INC_CATEGORY[r.category] || r.category,
    severity: INC_SEVERITY[r.severity] || r.severity,
    title: r.title,
    description: r.description || null,
    equipment: r.equipment || null,
    patrimony: r.patrimony || null,
    reporter: r.reported_by_name || null,
    classInfo: r.class_info || null,
    glpi: r.glpi_ticket || null,
    photos: Number(r.photo_count) || 0,
    status: INC_STATUS[r.status] || r.status,
    resolution: r.resolution || null,
    resolvedAt: dbDateTime(r.resolved_at),
    resolvedBy: r.resolved_by_name || null,
    author: r.author_name || null,
    created: dbDateTime(r.created_at),
  }))
  const open = r => r.status !== 'resolvido'
  const byLab = groupSum(rows, r => `${INC_BUILDING[r.building] || r.building} · ${r.lab}`, { open, done: r => !open(r) })
    .sort((a, b) => b.count - a.count)
  const byType = groupSum(rows, r => INC_CATEGORY[r.category] || r.category, { open, critical: r => open(r) && (r.severity === 'alta' || r.severity === 'critica') })
    .sort((a, b) => b.count - a.count)
  const where = building ? INC_BUILDING[building] || building.toUpperCase() : 'Todos os prédios'

  await downloadXlsx({
    fileName: `incidentes-laboratorios-${building || 'todos'}`,
    title: 'Incidentes Laboratórios',
    subtitle: `${where} · ${rows.length} incidente(s), ${rows.filter(open).length} em aberto`,
    author: author(),
    sheets: [
      {
        name: 'Incidentes',
        columns: [
          { header: 'Data e hora', key: 'occurred', width: 17, type: 'datetime' },
          { header: 'Prédio', key: 'building', width: 9 },
          { header: 'Laboratório / sala', key: 'lab', width: 20 },
          { header: 'Tipo', key: 'category', width: 21 },
          { header: 'Gravidade', key: 'severity', width: 11, badge: INC_SEVERITY_BADGE },
          { header: 'Resumo', key: 'title', width: 34, wrap: true },
          { header: 'Descrição', key: 'description', width: 44, wrap: true },
          { header: 'Equipamento', key: 'equipment', width: 22, wrap: true },
          { header: 'Patrimônio', key: 'patrimony', width: 12 },
          { header: 'Quem relatou', key: 'reporter', width: 20 },
          { header: 'Turma / professor', key: 'classInfo', width: 24, wrap: true },
          { header: 'Chamado GLPI', key: 'glpi', width: 12 },
          { header: 'Fotos', key: 'photos', width: 8, type: 'int', total: 'sum' },
          { header: 'Situação', key: 'status', width: 15, badge: INC_STATUS_BADGE, total: 'count' },
          { header: 'Solução / andamento', key: 'resolution', width: 40, wrap: true },
          { header: 'Resolvido em', key: 'resolvedAt', width: 17, type: 'datetime' },
          { header: 'Resolvido por', key: 'resolvedBy', width: 20 },
          { header: 'Registrado por', key: 'author', width: 20 },
          { header: 'Registrado em', key: 'created', width: 17, type: 'datetime' },
        ],
        rows: items,
      },
      {
        name: 'Por laboratório', title: 'Incidentes Laboratórios — por laboratório', tabColor: 'FF22C55E',
        columns: [
          { header: 'Laboratório', key: 'key', width: 32 },
          { header: 'Incidentes', key: 'count', width: 13, type: 'int', total: 'sum' },
          { header: 'Em aberto', key: 'open', width: 13, type: 'int', total: 'sum' },
          { header: 'Resolvidos', key: 'done', width: 13, type: 'int', total: 'sum' },
        ],
        rows: byLab,
      },
      {
        name: 'Por tipo', title: 'Incidentes Laboratórios — por tipo', tabColor: 'FF8B5CF6',
        columns: [
          { header: 'Tipo', key: 'key', width: 26 },
          { header: 'Incidentes', key: 'count', width: 13, type: 'int', total: 'sum' },
          { header: 'Em aberto', key: 'open', width: 13, type: 'int', total: 'sum' },
          { header: 'Alta/crítica em aberto', key: 'critical', width: 22, type: 'int', total: 'sum' },
        ],
        rows: byType,
      },
    ],
  })
}

// ── Estoque de insumos de impressoras ──────────────────────────────────────
const SUP_LOC = { sede: 'SEDE', adm: 'ADM', centro: 'CENTRO', g5: 'G5', clinicas: 'CLÍNICAS' }
const SUP_TYPE = { toner: 'Toner', cilindro: 'Cilindro / fotocondutor', tinta: 'Tinta (garrafa)', cartucho: 'Cartucho', fusor: 'Fusor', residuo: 'Caixa de resíduo', kit: 'Kit de manutenção', outro: 'Outro' }
const SUP_COLOR = { preto: 'Preto', ciano: 'Ciano', magenta: 'Magenta', amarelo: 'Amarelo', colorido: 'Colorido' }
const SUP_KIND = { entrada: 'Entrada', troca: 'Troca na impressora', transferencia_saida: 'Transferência (saída)', transferencia_entrada: 'Transferência (entrada)', ajuste: 'Ajuste de contagem' }
const SUP_STATUS_BADGE = { Repor: 'red', OK: 'green', 'Sem mínimo': 'gray' }

export async function exportPrinterSuppliesXlsx() {
  const { data } = await api.get('/printer-supplies/export')
  const supplies = data.supplies || []
  const movements = data.movements || []
  const stock = []
  for (const sp of supplies) {
    for (const [loc, label] of Object.entries(SUP_LOC)) {
      const st = sp.stocks?.[loc] || { quantity: 0, min_quantity: 0 }
      if (!st.quantity && !st.min_quantity && !sp.usage90?.[loc]) continue // prédio sem nada desse item
      stock.push({
        name: sp.name + (sp.active ? '' : ' (desativado)'), code: sp.code || null, type: SUP_TYPE[sp.type] || sp.type, color: SUP_COLOR[sp.color] || null,
        location: label, qty: st.quantity, min: st.min_quantity,
        status: !st.min_quantity ? 'Sem mínimo' : st.quantity <= st.min_quantity ? 'Repor' : 'OK',
        perMonth: (sp.usage90?.[loc] || 0) / 3, models: sp.models.join(', ') || null,
      })
    }
  }
  const moves = movements.map(m => ({
    when: (() => { const x = String(m.happened_at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return x ? new Date(Date.UTC(+x[1], +x[2] - 1, +x[3], +x[4], +x[5])) : null })(),
    location: SUP_LOC[m.location] || m.location, name: m.supply_name, code: m.supply_code || null,
    kind: SUP_KIND[m.kind] + (m.related_location ? ` — ${SUP_LOC[m.related_location]}` : ''),
    delta: m.delta, balance: m.balance_after,
    printer: m.printer_model ? `${m.printer_model}${m.printer_ip ? ` (${m.printer_ip})` : ''}` : null,
    note: m.note || null, user: m.user_name || null,
  }))
  const swaps = movements.filter(m => m.kind === 'troca' && m.printer_id)
  const byPrinter = groupSum(swaps, m => `${m.printer_model || '—'} · ${SUP_LOC[m.printer_location] || ''}${m.printer_ip ? ` · ${m.printer_ip}` : ''}`, { units: m => -m.delta })
    .map(g => ({ ...g, last: swaps.filter(m => `${m.printer_model || '—'} · ${SUP_LOC[m.printer_location] || ''}${m.printer_ip ? ` · ${m.printer_ip}` : ''}` === g.key).map(m => m.happened_at).sort().pop() }))
    .sort((a, b) => b.units - a.units)
    .map(g => ({ ...g, last: g.last ? new Date(Date.UTC(+g.last.slice(0, 4), +g.last.slice(5, 7) - 1, +g.last.slice(8, 10), +g.last.slice(11, 13), +g.last.slice(14, 16))) : null }))
  const toRepor = stock.filter(r => r.status === 'Repor').length

  await downloadXlsx({
    fileName: 'estoque-insumos-impressoras',
    title: 'Estoque de insumos de impressoras',
    subtitle: `${supplies.filter(s => s.active).length} itens no catálogo · ${toRepor} a repor`,
    author: author(),
    sheets: [
      {
        name: 'Saldo por prédio',
        columns: [
          { header: 'Insumo', key: 'name', width: 34, wrap: true },
          { header: 'Código', key: 'code', width: 12 },
          { header: 'Tipo', key: 'type', width: 20 },
          { header: 'Cor', key: 'color', width: 10 },
          { header: 'Prédio', key: 'location', width: 11 },
          { header: 'Saldo', key: 'qty', width: 9, type: 'int', total: 'sum' },
          { header: 'Mínimo', key: 'min', width: 9, type: 'int' },
          { header: 'Situação', key: 'status', width: 13, badge: SUP_STATUS_BADGE },
          { header: 'Consumo/mês', key: 'perMonth', width: 13, type: 'dec' },
          { header: 'Serve em', key: 'models', width: 36, wrap: true },
        ],
        rows: stock,
      },
      {
        name: 'Movimentações', title: 'Estoque de insumos — movimentações', tabColor: 'FF22C55E',
        columns: [
          { header: 'Quando', key: 'when', width: 17, type: 'datetime' },
          { header: 'Prédio', key: 'location', width: 11 },
          { header: 'Insumo', key: 'name', width: 32, wrap: true },
          { header: 'Código', key: 'code', width: 12 },
          { header: 'Movimento', key: 'kind', width: 28 },
          { header: 'Qtd', key: 'delta', width: 7, type: 'int' },
          { header: 'Saldo depois', key: 'balance', width: 13, type: 'int' },
          { header: 'Impressora', key: 'printer', width: 30, wrap: true },
          { header: 'Observação', key: 'note', width: 30, wrap: true },
          { header: 'Registrado por', key: 'user', width: 20, total: 'count' },
        ],
        rows: moves,
      },
      {
        name: 'Trocas por impressora', title: 'Estoque de insumos — trocas por impressora', tabColor: 'FF8B5CF6',
        columns: [
          { header: 'Impressora', key: 'key', width: 44 },
          { header: 'Trocas', key: 'count', width: 10, type: 'int', total: 'sum' },
          { header: 'Unidades usadas', key: 'units', width: 16, type: 'int', total: 'sum' },
          { header: 'Última troca', key: 'last', width: 17, type: 'datetime' },
        ],
        rows: byPrinter,
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
