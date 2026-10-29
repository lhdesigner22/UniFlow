import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import MemberPicker from '../components/common/MemberPicker'
import LineIcon from '../components/common/LineIcon'
import Avatar from '../components/common/Avatar'
import s from './ApprovalsPage.module.css'

// Mesmo teto aplicado em kb.js/printers.js — perto do limite real de corpo
// de requisição da Cloudflare no plano atual (100 MB).
const MAX_FILE_BYTES = 95 * 1024 * 1024

const STATUS_META = {
  pending: { label: 'Pendente', cls: 'statusPending' },
  approved: { label: 'Aprovado', cls: 'statusApproved' },
  rejected: { label: 'Reprovado', cls: 'statusRejected' },
}

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `há ${days}d`
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')
}

// Prazo em linguagem de gente; só alerta (vencido/hoje) enquanto está pendente
function dueInfo(due, status) {
  if (!due) return null
  const [y, m, d] = due.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((date - today) / 86400000)
  const plain = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
  if (status !== 'pending') return { text: `Prazo ${plain}`, tone: '' }
  if (diff < -1) return { text: `Venceu há ${-diff} dias`, tone: 'late' }
  if (diff === -1) return { text: 'Venceu ontem', tone: 'late' }
  if (diff === 0) return { text: 'Vence hoje', tone: 'soon' }
  if (diff === 1) return { text: 'Vence amanhã', tone: 'soon' }
  return { text: diff <= 7 ? `Vence em ${diff} dias` : `Prazo ${plain}`, tone: '' }
}

// "Assinaturas": cada aprovador com a marca da decisão (✓ aprovou, ✗ reprovou, relógio = falta)
// textOnly: só o resumo (no detalhe a lista de aprovadores já mostra as marcas)
function SignOffs({ approvers, size = 26, textOnly }) {
  const done = approvers.filter(a => a.decision === 'approved').length
  const rejectedBy = approvers.find(a => a.decision === 'rejected')
  return (
    <span className={s.signoffs}>
      {!textOnly && <span className={s.marks}>
        {approvers.slice(0, 5).map(a => (
          <span key={a.id} className={s.mark} data-decision={a.decision} title={`${a.user_name}: ${(STATUS_META[a.decision] || STATUS_META.pending).label.toLowerCase()}`}>
            <Avatar id={a.user_id} name={a.user_name} photo={a.user_avatar} size={size} />
            <span className={s.markIcon} aria-hidden="true">
              <LineIcon name={a.decision === 'approved' ? 'check' : a.decision === 'rejected' ? 'close' : 'clock'} size={9} />
            </span>
          </span>
        ))}
      </span>}
      <span className={s.signoffText}>
        {rejectedBy ? `${rejectedBy.user_name} reprovou` : `${done} de ${approvers.length} ${approvers.length === 1 ? 'aprovou' : 'aprovaram'}`}
      </span>
    </span>
  )
}

function ApprovalRow({ a, scope, onOpen }) {
  const meta = STATUS_META[a.status] || STATUS_META.pending
  const due = dueInfo(a.due_date, a.status)
  return (
    <li>
      <button type="button" className={s.row} onClick={onOpen}>
        <span className={s.rowMain}>
          <span className={s.rowTitle}>{a.title}</span>
          <span className={s.rowMeta}>
            {scope === 'received' ? `De ${a.requester_name}, ${timeAgo(a.created_at)}` : `Pedido ${timeAgo(a.created_at)}`}
            {!!a.has_attachment && <><LineIcon name="download" size={12} /> anexo</>}
          </span>
        </span>
        <span className={`${s.due} ${due?.tone ? s[due.tone] : ''}`}>
          {due && <><LineIcon name="calendar" size={13} />{due.text}</>}
        </span>
        <SignOffs approvers={a.approvers} size={24} />
        <span className={`${s.statusBadge} ${s[meta.cls]}`}>{meta.label}</span>
      </button>
    </li>
  )
}

// ── Nova solicitação ────────────────────────────────────────────────
function RequestModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [approvers, setApprovers] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const onFileChange = e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`Arquivo grande demais (${(f.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB.`)
      return
    }
    setFileError('')
    setFile(f)
  }

  const addApprover = u => { setApprovers(prev => [...prev, u]); setShowPicker(false) }
  const removeApprover = id => setApprovers(prev => prev.filter(a => a.id !== id))

  const submit = async () => {
    if (!title.trim() || approvers.length === 0) return
    setSaving(true)
    setError('')
    try {
      let saved = (await api.post('/approvals', {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        approver_ids: approvers.map(a => a.id),
      })).data

      if (file) {
        setSaving(false)
        setUploading(true)
        const fd = new FormData()
        fd.append('file', file)
        saved = (await api.post(`/approvals/${saved.id}/attachment`, fd, { timeout: 300_000 })).data
        setUploading(false)
      }

      onCreated(saved)
    } catch (e) {
      setSaving(false)
      setUploading(false)
      setError(e.response?.data?.error || 'Erro ao criar a solicitação. Tenta de novo?')
    }
  }

  return (
    <Modal title="Pedir aprovação" onClose={onClose} width={560}>
      <div className="form-group">
        <label htmlFor="approvals-titulo" className="label">Título</label>
        <input id="approvals-titulo" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Aprovar orçamento de material de TI" />
      </div>
      <div className="form-group">
        <label htmlFor="approvals-descricao-opcional" className="label">Descrição (opcional)</label>
        <textarea id="approvals-descricao-opcional" rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalhes do que precisa ser aprovado..." />
      </div>
      <div className="form-group">
        <label htmlFor="approvals-prazo-opcional" className="label">Prazo (opcional)</label>
        <input id="approvals-prazo-opcional" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div className="form-group">
        <span className="label" id="approvals-aprovadores">Quem aprova</span>
        <div className={s.chipsRow}>
          {approvers.map(a => (
            <span key={a.id} className={s.chip}>
              <Avatar id={a.id} name={a.name} photo={a.avatar} size={20} />
              {a.name}
              <button type="button" className={s.chipRemove} onClick={() => removeApprover(a.id)} aria-label={`Tirar ${a.name}`}>×</button>
            </span>
          ))}
          <div className={s.inviteWrap}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)} aria-describedby="approvals-aprovadores"><LineIcon name="user" size={14} /> Adicionar pessoa</button>
            {showPicker && (
              <MemberPicker
                existingIds={approvers.map(a => a.id)}
                onPick={addApprover}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="approvals-anexo" className="label">Anexo (opcional, até 95 MB)</label>
        {file ? (
          <div className={s.attachmentRow}>
            <span><LineIcon name="download" size={14} /> {file.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>Cancelar</button>
          </div>
        ) : (
          <input id="approvals-anexo" type="file" onChange={onFileChange} />
        )}
        {fileError && <p role="alert" className={s.fileError}>{fileError}</p>}
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!title.trim() || approvers.length === 0 || saving || uploading}
        onClick={submit}
      >
        {uploading ? 'Enviando anexo...' : saving ? 'Enviando...' : 'Enviar pedido'}
      </button>
    </Modal>
  )
}

// ── Detalhe / decisão ───────────────────────────────────────────────
function DetailModal({ approval, currentUser, onClose, onUpdated, onDeleted }) {
  const [comment, setComment] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [changingDecision, setChangingDecision] = useState(false)

  const isRequester = approval.requested_by === currentUser?.id
  const myApprover = approval.approvers.find(a => a.user_id === currentUser?.id)
  const alreadyDecided = myApprover && myApprover.decision !== 'pending'
  const canDecide = myApprover && (myApprover.decision === 'pending' || changingDecision)
  const status = STATUS_META[approval.status] || STATUS_META.pending

  const startChange = () => {
    setComment(myApprover?.comment || '')
    setError('')
    setChangingDecision(true)
  }

  const decide = async decision => {
    setDeciding(true)
    setError('')
    try {
      const { data } = await api.post(`/approvals/${approval.id}/decide`, { decision, comment: comment.trim() || null })
      onUpdated(data)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao registrar sua decisão.')
    } finally {
      setDeciding(false)
    }
  }

  const remove = async () => {
    const ok = await confirmDialog(`Excluir a solicitação "${approval.title}"?`, { title: 'Excluir solicitação' })
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`/approvals/${approval.id}`)
      onDeleted(approval.id)
    } catch (e) {
      setDeleting(false)
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  return (
    <Modal title={approval.title} onClose={onClose} width={560}>
      <div className={s.detailHeader}>
        <span className={`${s.statusBadge} ${s[status.cls]}`}>{status.label}</span>
        {(() => { const due = dueInfo(approval.due_date, approval.status); return due && (
          <span className={`${s.due} ${due.tone ? s[due.tone] : ''}`}><LineIcon name="calendar" size={13} />{due.text}</span>
        ) })()}
      </div>

      <div className={s.metaRow}>
        <Avatar id={approval.requested_by} name={approval.requester_name} photo={approval.requester_avatar} size={22} />
        <span>Pedido por <strong>{approval.requester_name}</strong>, {timeAgo(approval.created_at)}</span>
      </div>

      {approval.description && <p className={s.description}>{approval.description}</p>}

      {!!approval.has_attachment && (
        <button type="button" className={`btn btn-ghost btn-sm ${s.attachBtn}`} onClick={() => downloadFile(`/approvals/${approval.id}/attachment`, approval.attachment_name || 'anexo')}>
          <LineIcon name="download" size={14} /> Baixar {approval.attachment_name}
        </button>
      )}

      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Quem aprova</h3>
          <SignOffs approvers={approval.approvers} textOnly />
        </div>
        <ul className={s.approverList}>
          {approval.approvers.map(a => {
            const meta = STATUS_META[a.decision] || STATUS_META.pending
            return (
              <li key={a.id} className={s.approverRow}>
                <span className={s.mark} data-decision={a.decision}>
                  <Avatar id={a.user_id} name={a.user_name} photo={a.user_avatar} size={28} />
                  <span className={s.markIcon} aria-hidden="true">
                    <LineIcon name={a.decision === 'approved' ? 'check' : a.decision === 'rejected' ? 'close' : 'clock'} size={9} />
                  </span>
                </span>
                <div className={s.approverInfo}>
                  <span className={s.approverName}>{a.user_name}{a.user_id === currentUser?.id && <span className={s.you}> (você)</span>}</span>
                  {a.comment && <span className={s.approverComment}>{a.comment}</span>}
                </div>
                <span className={`${s.statusBadge} ${s[meta.cls]}`}>{meta.label}</span>
              </li>
            )
          })}
        </ul>
      </div>

      {alreadyDecided && !changingDecision && (
        <div className={s.section}>
          <h3 className={s.sectionTitle}>Sua decisão</h3>
          <div className={s.decideRow}>
            <span className={`${s.statusBadge} ${s[(STATUS_META[myApprover.decision] || STATUS_META.pending).cls]}`}>
              {(STATUS_META[myApprover.decision] || STATUS_META.pending).label}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={startChange}>Errei, trocar decisão</button>
          </div>
        </div>
      )}

      {canDecide && (
        <div className={s.section}>
          <h3 className={s.sectionTitle}><label htmlFor="approval-comment">Sua decisão</label></h3>
          <textarea
            id="approval-comment"
            rows={2}
            placeholder="Comentário (opcional): o motivo ajuda quem pediu"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
          <div className={s.decideButtons}>
            <button className={`${s.decideBtn} ${s.approve}`} disabled={deciding} onClick={() => decide('approved')}>
              <LineIcon name="check" size={16} /> Aprovar
            </button>
            <button className={`${s.decideBtn} ${s.reject}`} disabled={deciding} onClick={() => decide('rejected')}>
              <LineIcon name="close" size={16} /> Reprovar
            </button>
          </div>
          {changingDecision && (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} disabled={deciding} onClick={() => setChangingDecision(false)}>Manter a decisão anterior</button>
          )}
          {error && <p role="alert" className={s.fileError}>{error}</p>}
        </div>
      )}

      {isRequester && (
        <div className={s.dangerZone}>
          <button className={`btn btn-ghost btn-sm ${s.dangerBtn}`} disabled={deleting} onClick={remove}>
            <LineIcon name="trash" size={14} /> Excluir solicitação
          </button>
        </div>
      )}
    </Modal>
  )
}

export default function ApprovalsPage() {
  const { user } = useAuthStore()
  const [scope, setScope] = useState('received')
  const [approvals, setApprovals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)

  // `silent` = recarga em segundo plano (tempo real): sem "carregando" e, se
  // falhar, mantém o que já está na tela.
  const load = (scopeToLoad, silent = false) => {
    if (!silent) setLoading(true)
    api.get('/approvals', { params: { scope: scopeToLoad } })
      .then(r => setApprovals(r.data || []))
      .catch(() => { if (!silent) setApprovals([]) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(scope) }, [scope])
  useLiveRefresh(['approvals'], () => load(scope, true)) // outro aparelho criou/decidiu uma aprovação

  const pendingMineCount = useMemo(
    () => (approvals || []).filter(a => a.my_decision === 'pending').length,
    [approvals]
  )

  const onCreated = approval => {
    setCreating(false)
    if (scope === 'sent') setApprovals(prev => [approval, ...(prev || [])])
    else load(scope)
  }

  const onUpdated = approval => {
    setApprovals(prev => (prev || []).map(a => a.id === approval.id ? { ...a, ...approval, my_decision: approval.approvers?.find(x => x.user_id === user?.id)?.decision ?? a.my_decision } : a))
    setOpenId(null)
  }

  const onDeleted = id => {
    setApprovals(prev => (prev || []).filter(a => a.id !== id))
    setOpenId(null)
  }

  const openApproval = (approvals || []).find(a => a.id === openId)

  if (loading && !approvals) return <div className={s.loading}>Carregando aprovações...</div>

  const list = approvals || []
  const waiting = scope === 'received' ? list.filter(a => a.my_decision === 'pending') : list.filter(a => a.status === 'pending')
  const rest = scope === 'received' ? list.filter(a => a.my_decision !== 'pending') : list.filter(a => a.status !== 'pending')
  const lateCount = waiting.filter(a => dueInfo(a.due_date, a.status)?.tone === 'late').length

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Aprovações</h1>
          <p className={s.sub}>
            {scope === 'received'
              ? (waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'pedido espera' : 'pedidos esperam'} a sua decisão${lateCount ? `, ${lateCount} com prazo vencido` : ''}.` : 'Nenhum pedido esperando a sua decisão.')
              : `Você pediu ${list.length} ${list.length === 1 ? 'aprovação' : 'aprovações'}; ${waiting.length} ainda em andamento.`}
          </p>
        </div>
        {canEditModule(user, 'approvals') && <button className="btn btn-primary" onClick={() => setCreating(true)}><LineIcon name="plus" size={15} /> Pedir aprovação</button>}
      </div>

      <nav className={s.tabs} aria-label="Aprovações">
        <button type="button" aria-current={scope === 'received' ? 'true' : undefined} className={`${s.tab} ${scope === 'received' ? s.tabActive : ''}`} onClick={() => setScope('received')}>
          Recebidas {scope === 'received' && pendingMineCount > 0 && <span className={s.tabCount}>{pendingMineCount}</span>}
        </button>
        <button type="button" aria-current={scope === 'sent' ? 'true' : undefined} className={`${s.tab} ${scope === 'sent' ? s.tabActive : ''}`} onClick={() => setScope('sent')}>
          Enviadas
        </button>
      </nav>

      {list.length === 0 ? (
        <div className={s.empty}>
          <h2>{scope === 'received' ? 'Ninguém pediu sua aprovação ainda' : 'Você ainda não pediu nenhuma aprovação'}</h2>
          <p>{scope === 'received' ? 'Quando alguém pedir, o pedido aparece aqui e no sininho.' : 'Use "Pedir aprovação" para mandar um pedido a uma ou mais pessoas.'}</p>
        </div>
      ) : (
        <div className={s.groups}>
          {[
            [scope === 'received' ? 'Esperando você' : 'Em andamento', waiting],
            [scope === 'received' ? 'Já decididas por você' : 'Concluídas', rest],
          ].filter(([, items]) => items.length).map(([label, items]) => (
            <section key={label} className={s.group} aria-label={label}>
              <h2 className={s.groupTitle}>{label}<span className={s.groupCount}>{items.length}</span></h2>
              <ul className={s.list}>
                {items.map(a => <ApprovalRow key={a.id} a={a} scope={scope} onOpen={() => setOpenId(a.id)} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {creating && <RequestModal onClose={() => setCreating(false)} onCreated={onCreated} />}
      {openApproval && (
        <DetailModal
          approval={openApproval}
          currentUser={user}
          onClose={() => setOpenId(null)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}
