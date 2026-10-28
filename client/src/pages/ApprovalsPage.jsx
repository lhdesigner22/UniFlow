import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import MemberPicker from '../components/common/MemberPicker'
import Reveal from '../components/common/Reveal'
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
    <Modal title="Nova solicitação de aprovação" onClose={onClose} width={560}>
      <div className="form-group">
        <label className="label">Título</label>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Aprovar orçamento de material de TI" />
      </div>
      <div className="form-group">
        <label className="label">Descrição (opcional)</label>
        <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalhes do que precisa ser aprovado..." />
      </div>
      <div className="form-group">
        <label className="label">Prazo (opcional)</label>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="label">Aprovadores</label>
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
      </div>
      <div className="form-group">
        <label className="label">Anexo (opcional, até 95 MB)</label>
        {file ? (
          <div className={s.attachmentRow}>
            <span>📎 {file.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>✕ Cancelar</button>
          </div>
        ) : (
          <input type="file" onChange={onFileChange} />
        )}
        {fileError && <p className={s.fileError}>{fileError}</p>}
      </div>
      {error && <p className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!title.trim() || approvers.length === 0 || saving || uploading}
        onClick={submit}
      >
        {uploading ? 'Enviando anexo...' : saving ? 'Enviando...' : 'Enviar solicitação'}
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
        {approval.due_date && <span className={s.dueBadge}>📅 Prazo: {approval.due_date.slice(0, 10).split('-').reverse().join('/')}</span>}
      </div>

      <div className={s.metaRow}>
        <Avatar id={approval.requested_by} name={approval.requester_name} photo={approval.requester_avatar} size={22} />
        <span>Solicitado por <strong>{approval.requester_name}</strong> · {timeAgo(approval.created_at)}</span>
      </div>

      {approval.description && <p className={s.description}>{approval.description}</p>}

      {!!approval.has_attachment && (
        <button type="button" className={s.cardLink} onClick={() => downloadFile(`/approvals/${approval.id}/attachment`, approval.attachment_name || 'anexo')}>
          📎 Baixar {approval.attachment_name}
        </button>
      )}

      <div className={s.section}>
        <span className={s.sectionTitle}>Aprovadores</span>
        <div className={s.approverList}>
          {approval.approvers.map(a => {
            const meta = STATUS_META[a.decision] || STATUS_META.pending
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
      </div>

      {alreadyDecided && !changingDecision && (
        <div className={s.section}>
          <span className={s.sectionTitle}>Sua decisão</span>
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

      {isRequester && (
        <div className={s.dangerZone}>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={deleting} onClick={remove}>
            🗑 Excluir solicitação
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

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Aprovações</h1>
          <p className={s.sub}>Peça aprovação pra qualquer pessoa e acompanhe as decisões — no estilo do Aprovações do Teams.</p>
        </div>
        {canEditModule(user, 'approvals') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nova solicitação</button>}
      </div>

      <div className={s.tabs}>
        <button className={`${s.tab} ${scope === 'received' ? s.tabActive : ''}`} onClick={() => setScope('received')}>
          Recebidas {scope === 'received' && pendingMineCount > 0 && <span className={s.tabCount}>{pendingMineCount}</span>}
        </button>
        <button className={`${s.tab} ${scope === 'sent' ? s.tabActive : ''}`} onClick={() => setScope('sent')}>
          Enviadas
        </button>
      </div>

      {(approvals || []).length === 0 ? (
        <div className={s.empty}>
          <h3>{scope === 'received' ? 'Nenhuma aprovação pra você' : 'Nenhuma solicitação enviada'}</h3>
          <p>{scope === 'received' ? 'Quando alguém pedir sua aprovação, aparece aqui.' : 'Clique em "+ Nova solicitação" pra pedir uma aprovação.'}</p>
        </div>
      ) : (
        <div className={s.list}>
          {(approvals || []).map((a, i) => {
            const meta = STATUS_META[a.status] || STATUS_META.pending
            return (
              <Reveal key={a.id} delay={Math.min(i, 10) * 45} className={s.row} onClick={() => setOpenId(a.id)}>
                <div className={s.rowMain}>
                  <span className={s.rowTitle}>{a.title}</span>
                  <span className={s.rowMeta}>
                    {scope === 'received' ? `De ${a.requester_name}` : `${a.approvers.length} aprovador${a.approvers.length === 1 ? '' : 'es'}`}
                    {' · '}{timeAgo(a.created_at)}
                  </span>
                </div>
                <div className={s.rowAvatars}>
                  {(scope === 'received' ? [{ id: a.requested_by, name: a.requester_name, avatar: a.requester_avatar }] : a.approvers.map(x => ({ id: x.user_id, name: x.user_name, avatar: x.user_avatar })))
                    .slice(0, 4)
                    .map((p, i) => <Avatar key={i} id={p.id} name={p.name} photo={p.avatar} size={24} />)}
                </div>
                <span className={`${s.statusBadge} ${s[meta.cls]}`}>{meta.label}</span>
              </Reveal>
            )
          })}
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
