import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { exportPurchasesXlsx } from '../utils/exports'
import ExportXlsxButton from '../components/common/ExportXlsxButton'
import { parseDbTimestamp } from '../utils/formatDuration'
import { currentMonth, monthLabel, buildMonthOptions } from '../utils/months'
import Modal from '../components/common/Modal'
import MemberPicker from '../components/common/MemberPicker'
import Reveal from '../components/common/Reveal'
import Avatar from '../components/common/Avatar'
import s from './PurchaseRequestsPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import { safeHref } from '../utils/safeHref'

const STATUSES = [
  { key: 'pendente', label: 'Pendente' },
  { key: 'aprovado', label: 'Aprovado' },
  { key: 'enviada_ao_gestor', label: 'Enviada ao Gestor' },
  { key: 'reprovado', label: 'Reprovado' },
  { key: 'comprado', label: 'Comprado' },
  { key: 'entregue', label: 'Entregue' },
]

// O select "manual" (Enviada ao Gestor/Comprado/Entregue) só faz sentido
// depois que os aprovadores já aprovaram — antes disso o status é decidido
// só por eles (ver botões Aprovar/Reprovar), nunca digitado à mão.
const MANUAL_STEPS = {
  aprovado: ['aprovado', 'enviada_ao_gestor', 'comprado', 'entregue'],
  enviada_ao_gestor: ['enviada_ao_gestor', 'comprado', 'entregue'],
  comprado: ['comprado', 'entregue'],
}

const DECISION_META = {
  pending: { label: 'Pendente', cls: 'decisionPending' },
  approved: { label: 'Aprovado', cls: 'decisionApproved' },
  rejected: { label: 'Reprovado', cls: 'decisionRejected' },
}

const GLPI_BASE_URL = 'https://glpi.inventario.unifecaf.edu.br'

function fmtMoney(n) {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDateTime(v) {
  return parseDbTimestamp(v).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Editor({ request, defaultMonth, onClose, onSaved }) {
  const [form, setForm] = useState({
    item_name: request?.item_name || '',
    ticket_number: request?.ticket_number || '',
    department: request?.department || '',
    description: request?.description || '',
    location: request?.location || '',
    quantity: request?.quantity ?? 1,
    unit_price: request?.unit_price ?? '',
    link_url: request?.link_url || '',
    notes: request?.notes || '',
    reference_month: request?.reference_month || defaultMonth || currentMonth(),
    department_id: request ? request.department_id : defaultDepartment(),
  })
  const [approvers, setApprovers] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const monthOptions = useMemo(() => buildMonthOptions(request?.reference_month ? [request.reference_month] : []), [request])

  const addApprover = u => { setApprovers(prev => [...prev, u]); setShowPicker(false) }
  const removeApprover = id => setApprovers(prev => prev.filter(a => a.id !== id))

  const save = async () => {
    if (!form.item_name.trim()) return
    if (!request && approvers.length === 0) return
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, quantity: Number(form.quantity) || 1, unit_price: Number(form.unit_price) || 0 }
      const saved = request
        ? (await api.put(`/purchase-requests/${request.id}`, payload)).data
        : (await api.post('/purchase-requests', { ...payload, approver_ids: approvers.map(a => a.id) })).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={request ? 'Editar solicitação' : 'Nova solicitação de compra'} onClose={onClose} width={560}>
      <div className="form-group">
        <label className="label">Nome do item</label>
        <input autoFocus value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} placeholder="Ex: Fonte Slim Bivolt com Cabo" />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Mês de referência</label>
          <select value={form.reference_month} onChange={e => setForm(f => ({ ...f, reference_month: e.target.value }))}>
            {monthOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Chamado (opcional)</label>
          <input value={form.ticket_number} onChange={e => setForm(f => ({ ...f, ticket_number: e.target.value }))} placeholder="Ex: 15780" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Departamento</label>
          <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Ex: TI, RH, Cobrança..." />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Descrição</label>
        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex: Adaptador VGA para HDMI" />
      </div>
      <div className="form-group">
        <label className="label">Unidade / Sede</label>
        <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Ex: SEDE/CENTRO, ADM..." />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Qtd</label>
          <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Valor unitário (R$)</label>
          <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} placeholder="0,00" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Valor total</label>
          <input value={fmtMoney((Number(form.quantity) || 0) * (Number(form.unit_price) || 0))} disabled />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Link</label>
        <input value={form.link_url} onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))} placeholder="Link do produto/orçamento" />
      </div>
      <div className="form-group">
        <label className="label">Observação</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Motivo, contexto, urgência..." />
      </div>

      {!request && (
        <div className="form-group">
          <label className="label">Aprovador(es)</label>
          <div className={s.chipsRow}>
            {approvers.map(a => (
              <span key={a.id} className={s.chip}>
                <Avatar id={a.id} name={a.name} photo={a.avatar} size={20} />
                {a.name}
                <button type="button" className={s.chipRemove} onClick={() => removeApprover(a.id)}>×</button>
              </span>
            ))}
            <div className={s.inviteWrap}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)}>+ Adicionar</button>
              {showPicker && (
                <MemberPicker
                  existingIds={approvers.map(a => a.id)}
                  onPick={addApprover}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          </div>
          <p className={s.hint}>Quem escolher aqui precisa aprovar antes do item avançar pra compra.</p>
        </div>
      )}

      {error && <p className={s.fileError}>{error}</p>}
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.item_name.trim() || (!request && approvers.length === 0) || saving}
        onClick={save}
      >
        {saving ? 'Salvando...' : request ? 'Salvar' : 'Enviar solicitação'}
      </button>
    </Modal>
  )
}

// Modal com a lista de aprovadores + decisão de quem for aprovador —
// mesmo padrão do DetailModal de ApprovalsPage.jsx.
function ApproversModal({ request, currentUser, onClose, onUpdated }) {
  const [comment, setComment] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState('')
  const [changingDecision, setChangingDecision] = useState(false)

  const myApprover = request.approvers.find(a => a.user_id === currentUser?.id)
  const alreadyDecided = myApprover && myApprover.decision !== 'pending'
  const canDecide = myApprover && (myApprover.decision === 'pending' || changingDecision)

  const startChange = () => {
    setComment(myApprover?.comment || '')
    setError('')
    setChangingDecision(true)
  }

  const decide = async decision => {
    setDeciding(true)
    setError('')
    try {
      const { data } = await api.post(`/purchase-requests/${request.id}/decide`, { decision, comment: comment.trim() || null })
      onUpdated(data)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao registrar sua decisão.')
    } finally {
      setDeciding(false)
    }
  }

  return (
    <Modal title={`Aprovadores — ${request.item_name}`} onClose={onClose} width={480}>
      <div className={s.approverList}>
        {request.approvers.map(a => {
          const meta = DECISION_META[a.decision] || DECISION_META.pending
          return (
            <div key={a.id} className={s.approverRow}>
              <Avatar id={a.user_id} name={a.user_name} photo={a.user_avatar} size={26} />
              <div className={s.approverInfo}>
                <span className={s.approverName}>{a.user_name}</span>
                {a.comment && <span className={s.approverComment}>"{a.comment}"</span>}
              </div>
              <span className={`${s.statusBadge} ${s[meta.cls]}`}>{meta.label}</span>
            </div>
          )
        })}
      </div>

      {alreadyDecided && !changingDecision && (
        <div className={s.section}>
          <span className={s.sectionTitle}>Sua decisão</span>
          <div className={s.decideRow}>
            <span className={`${s.statusBadge} ${s[(DECISION_META[myApprover.decision] || DECISION_META.pending).cls]}`}>
              {(DECISION_META[myApprover.decision] || DECISION_META.pending).label}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={startChange}>Errei, trocar decisão</button>
          </div>
        </div>
      )}

      {canDecide && (
        <div className={s.section}>
          <span className={s.sectionTitle}>Sua decisão</span>
          <textarea
            rows={2}
            placeholder="Comentário (opcional)"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
          <div className={s.decideRow}>
            <button className="btn btn-primary btn-sm" style={{ background: 'var(--success, #22c55e)' }} disabled={deciding} onClick={() => decide('approved')}>
              ✓ Aprovar
            </button>
            <button className="btn btn-danger btn-sm" disabled={deciding} onClick={() => decide('rejected')}>
              ✕ Reprovar
            </button>
            {changingDecision && (
              <button className="btn btn-ghost btn-sm" disabled={deciding} onClick={() => setChangingDecision(false)}>Cancelar</button>
            )}
          </div>
          {error && <p className={s.fileError}>{error}</p>}
        </div>
      )}

      {request.status_log?.length > 0 && (
        <div className={s.section}>
          <span className={s.sectionTitle}>Histórico de status</span>
          <div className={s.historyList}>
            {request.status_log.map(l => (
              <div key={l.id} className={s.historyRow}>
                <Avatar id={l.changed_by} name={l.changed_by_name} photo={l.changed_by_avatar} size={24} />
                <div className={s.historyInfo}>
                  <span className={s.historyGiver}>
                    {l.changed_by_name} → <strong>{STATUSES.find(st => st.key === l.status)?.label || l.status}</strong>
                  </span>
                  <span className={s.historyMeta}>{fmtDateTime(l.created_at)}{l.comment ? ` · "${l.comment}"` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// Pede um comentário opcional antes de confirmar a troca manual de status
// (Enviada ao Gestor/Comprado/Entregue) — fica registrado no Histórico de
// status pra dar pra ver depois o que a pessoa escreveu na hora.
function StatusChangeModal({ request, targetStatus, onClose, onChanged }) {
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const label = STATUSES.find(st => st.key === targetStatus)?.label || targetStatus

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = await api.post(`/purchase-requests/${request.id}/status`, { status: targetStatus, comment: comment.trim() || null })
      onChanged(data)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao atualizar status.')
      setSaving(false)
    }
  }

  return (
    <Modal title={`Mudar status para "${label}"`} onClose={onClose} width={420}>
      <div className="form-group">
        <label className="label">Comentário (opcional)</label>
        <textarea
          autoFocus rows={3} value={comment} onChange={e => setComment(e.target.value)}
          placeholder="Ex: Gestor pediu pra revisar o orçamento antes..."
        />
      </div>
      {error && <p className={s.fileError}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={confirm}>
        {saving ? 'Salvando...' : `Confirmar → ${label}`}
      </button>
    </Modal>
  )
}

export default function PurchaseRequestsPage() {
  const { user } = useAuthStore()
  const { month: monthParam } = useParams()
  const monthFilter = monthParam && monthParam !== 'todos' ? monthParam : ''
  const [requests, setRequests] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, item = editar
  const [approversFor, setApproversFor] = useState(null) // id da solicitação aberta no ApproversModal
  const [statusChangeFor, setStatusChangeFor] = useState(null) // { request, targetStatus } aberto no StatusChangeModal
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  useLiveRefresh(['purchase-requests'], () => load())
  const load = () => {
    api.get('/purchase-requests')
      .then(r => setRequests(r.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (requests || []).filter(r => {
      if (statusFilter && r.status !== statusFilter) return false
      if (monthFilter && r.reference_month !== monthFilter) return false
      if (term && !`${r.item_name} ${r.department || ''} ${r.description || ''} ${r.ticket_number || ''}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [requests, statusFilter, monthFilter, search])

  const totals = useMemo(() => {
    const items = filtered.length
    const units = filtered.reduce((sum, r) => sum + (r.quantity || 0), 0)
    const total = filtered.reduce((sum, r) => sum + (r.quantity || 0) * (r.unit_price || 0), 0)
    const done = filtered
      .filter(r => ['aprovado', 'enviada_ao_gestor', 'comprado', 'entregue'].includes(r.status))
      .reduce((sum, r) => sum + (r.quantity || 0) * (r.unit_price || 0), 0)
    return { items, units, total, done }
  }, [filtered])

  const onSaved = saved => {
    setRequests(prev => {
      const exists = (prev || []).some(r => r.id === saved.id)
      return exists ? prev.map(r => r.id === saved.id ? saved : r) : [saved, ...(prev || [])]
    })
    setEditing(null)
  }

  const onApproversUpdated = updated => {
    setRequests(prev => (prev || []).map(r => r.id === updated.id ? updated : r))
    setApproversFor(null)
  }

  const onStatusChanged = updated => {
    setRequests(prev => (prev || []).map(r => r.id === updated.id ? updated : r))
    setStatusChangeFor(null)
  }

  const deleteRequest = async r => {
    const ok = await confirmDialog(`Excluir a solicitação "${r.item_name}"?`, { title: 'Excluir solicitação' })
    if (!ok) return
    try {
      await api.delete(`/purchase-requests/${r.id}`)
      setRequests(prev => (prev || []).filter(x => x.id !== r.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir a solicitação.', { title: 'Erro', danger: true })
    }
  }

  const writable = canEditModule(user, 'purchases')
  const canEdit = r => writable && (r.created_by === user?.id || user?.system_role === 'super_admin')
  const exportXlsx = () => exportPurchasesXlsx({ month: monthFilter || undefined }) // o mês que a tela está mostrando
  const exportApprovedXlsx = () => exportPurchasesXlsx({ month: monthFilter || undefined, onlyApproved: true })

  const openApprovers = (requests || []).find(r => r.id === approversFor)

  if (loading) return <div className={s.loading}>Carregando solicitações...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Solicitação de Compra — {monthFilter ? monthLabel(monthFilter) : 'Todos os meses'}</h1>
          <p className={s.sub}>Itens pedidos, aprovador, valores e status — do pedido até a entrega.</p>
        </div>
        <div className={s.headerRight}>
          <ExportXlsxButton onExport={exportXlsx} />
          <ExportXlsxButton onExport={exportApprovedXlsx} label="Excel só aprovados" />
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Nova solicitação</button>}
        </div>
      </div>

      <div className={s.kpiRow}>
        <div className={`${s.kpiCard} ${s.kpiTotal}`}>
          <span className={s.kpiNumber}>{totals.items}</span>
          <span className={s.kpiLabel}>Itens</span>
        </div>
        <div className={s.kpiCard}>
          <span className={s.kpiNumber}>{totals.units}</span>
          <span className={s.kpiLabel}>Unidades (qtd)</span>
        </div>
        <div className={s.kpiCard}>
          <span className={s.kpiNumber}>{fmtMoney(totals.total)}</span>
          <span className={s.kpiLabel}>Valor total</span>
        </div>
        <div className={`${s.kpiCard} ${s.kpiDone}`}>
          <span className={s.kpiNumber}>{fmtMoney(totals.done)}</span>
          <span className={s.kpiLabel}>Aprovado, enviado ou concluído</span>
        </div>
      </div>

      {(requests || []).length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhuma solicitação ainda</h3>
          <p>Cadastre o primeiro item que precisa ser comprado.</p>
        </div>
      ) : (
        <Reveal className={s.tableCard}>
          <div className={s.tableFilters}>
            <input
              className={s.searchInput}
              placeholder="Buscar por item, departamento, chamado..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">Todos os status</option>
              {STATUSES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
            </select>
            <span className={s.tableCount}>{filtered.length} item(ns)</span>
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Mês</th><th>Item</th><th>Chamado</th><th>Departamento / Unidade</th>
                  <th>Qtd</th><th>Vlr. unit.</th><th>Vlr. total</th>
                  <th>Link</th><th>Observação</th><th>Aprovador</th>
                  <th className={s.stickyStatus}>Status</th><th className={s.stickyActions}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const meta = STATUSES.find(st => st.key === r.status) || STATUSES[0]
                  const myPending = r.my_decision === 'pending' && !['enviada_ao_gestor', 'comprado', 'entregue'].includes(r.status)
                  const manualOptions = MANUAL_STEPS[r.status]
                  return (
                    <tr key={r.id}>
                      <td className={s.mono}>{monthLabel(r.reference_month)}</td>
                      <td className={s.itemCell}>
                        <span className={s.itemName} title={r.item_name}>{r.item_name}</span>
                        {r.description && <span className={s.itemDesc} title={r.description}>{r.description}</span>}
                      </td>
                      <td className={s.mono}>
                        {r.ticket_number
                          ? <a href={`${GLPI_BASE_URL}/front/ticket.form.php?id=${r.ticket_number}`} target="_blank" rel="noreferrer">#{r.ticket_number}</a>
                          : '—'}
                      </td>
                      <td className={s.itemCell}>
                        <span className={s.itemName}>{r.department || '—'}</span>
                        {r.location && <span className={s.itemDesc}>{r.location}</span>}
                      </td>
                      <td className={s.mono}>{r.quantity}</td>
                      <td className={s.mono}>{fmtMoney(r.unit_price)}</td>
                      <td className={s.mono}>{fmtMoney(r.quantity * r.unit_price)}</td>
                      <td className={s.linkCell}>
                        {r.link_url
                          ? <a className={s.cardLink} href={safeHref(r.link_url)} target="_blank" rel="noreferrer" title={r.link_url}>🔗</a>
                          : '—'}
                      </td>
                      <td className={s.descCell} title={r.notes}>{r.notes || '—'}</td>
                      <td>
                        <button type="button" className={s.approverBtn} onClick={() => setApproversFor(r.id)} title="Ver aprovadores">
                          {r.approvers.slice(0, 3).map((a, i) => (
                            <Avatar key={a.id} id={a.user_id} name={a.user_name} photo={a.user_avatar} size={22} style={i > 0 ? { marginLeft: -6 } : undefined} />
                          ))}
                          {myPending && <span className={s.pendingDot} title="Aguardando sua decisão" />}
                        </button>
                      </td>
                      <td className={s.stickyStatus}>
                        {manualOptions ? (
                          <select
                            className={s.statusSelect}
                            data-status={r.status}
                            value={r.status}
                            onChange={e => setStatusChangeFor({ request: r, targetStatus: e.target.value })}
                          >
                            {manualOptions.map(key => <option key={key} value={key}>{STATUSES.find(st => st.key === key).label}</option>)}
                          </select>
                        ) : (
                          <button type="button" className={`${s.statusSelect} ${s.statusReadonly}`} data-status={r.status} onClick={() => setApproversFor(r.id)}>
                            {meta.label}
                          </button>
                        )}
                      </td>
                      <td className={s.stickyActions}>
                        {canEdit(r) && (
                          <div className={s.rowActions}>
                            <button className={s.iconBtn} title="Editar" onClick={() => setEditing(r)}>✏️</button>
                            <button className={s.iconBtn} title="Excluir" onClick={() => deleteRequest(r)}>🗑️</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={12} className={s.chartEmpty}>Nenhuma solicitação bate com esse filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {editing && (
        <Editor
          request={editing.id ? editing : null}
          defaultMonth={monthFilter || currentMonth()}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {openApprovers && (
        <ApproversModal
          request={openApprovers}
          currentUser={user}
          onClose={() => setApproversFor(null)}
          onUpdated={onApproversUpdated}
        />
      )}

      {statusChangeFor && (
        <StatusChangeModal
          request={statusChangeFor.request}
          targetStatus={statusChangeFor.targetStatus}
          onClose={() => setStatusChangeFor(null)}
          onChanged={onStatusChanged}
        />
      )}
    </div>
  )
}
