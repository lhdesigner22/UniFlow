import { useState, useEffect, useRef } from 'react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import Modal from '../common/Modal'
import s from './DemandModal.module.css'

const STATUS_OPTIONS = [
  { value: 'aberto',       label: 'Aberto' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluido',    label: 'Concluído' },
  { value: 'cancelado',    label: 'Cancelado' },
]

const PRIORITY_OPTIONS = [
  { value: '',      label: '— Sem prioridade' },
  { value: 'baixa', label: 'Baixa' },
  { value: 'media', label: 'Média' },
  { value: 'alta',  label: 'Alta' },
]

// "2026-08-25T10:00:00.000Z" / "2026-08-25 10:00:00" → "2026-08-25T10:00" (for <input type="datetime-local">)
function toDatetimeLocalValue(value) {
  if (!value) return ''
  const d = new Date(value.includes('T') || value.includes('Z') ? value : value.replace(' ', 'T'))
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function DemandModal({ type, demand, onClose, onSaved }) {
  const isEdit = !!demand?.id
  const { user } = useAuthStore()

  const [form, setForm] = useState({
    title: demand?.title || '',
    description: demand?.description || '',
    department_id: demand?.department_id || '',
    status: demand?.status || 'aberto',
    priority: demand?.priority || '',
    due_date: demand?.due_date ? demand.due_date.slice(0, 10) : '',
    event_date: toDatetimeLocalValue(demand?.event_date),
    location: demand?.location || '',
    assigned_to: demand?.assigned_to || '',
  })

  const [departments, setDepartments] = useState([])
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')

  // Assignee typeahead
  const [assigneeQuery, setAssigneeQuery] = useState(demand?.assigned_to_name || '')
  const [assigneeResults, setAssigneeResults] = useState([])
  const [showAssigneeDrop, setShowAssigneeDrop] = useState(false)
  const assigneeTimer = useRef(null)
  const assigneeBoxRef = useRef(null)

  useEffect(() => {
    api.get('/departments').then(r => setDepartments(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!demand?.id) return
    setLoadingDetail(true)
    api.get(`/demands/${demand.id}`)
      .then(r => setDetail(r.data))
      .catch(() => {})
      .finally(() => setLoadingDetail(false))
  }, [demand?.id])

  useEffect(() => {
    clearTimeout(assigneeTimer.current)
    const q = assigneeQuery.trim()
    if (q.length < 2) { setAssigneeResults([]); return }
    assigneeTimer.current = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(q)}`)
        .then(r => { setAssigneeResults(r.data); setShowAssigneeDrop(true) })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(assigneeTimer.current)
  }, [assigneeQuery])

  useEffect(() => {
    const handler = e => {
      if (assigneeBoxRef.current && !assigneeBoxRef.current.contains(e.target)) setShowAssigneeDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectAssignee = (u) => {
    setForm(f => ({ ...f, assigned_to: u.id }))
    setAssigneeQuery(u.name)
    setShowAssigneeDrop(false)
  }
  const clearAssignee = () => {
    setForm(f => ({ ...f, assigned_to: '' }))
    setAssigneeQuery('')
  }

  const save = async () => {
    if (!form.title.trim()) { setError('Título é obrigatório'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        title: form.title,
        description: form.description || null,
        department_id: form.department_id || null,
        priority: type === 'chamado' ? (form.priority || null) : null,
        due_date: type === 'chamado' ? (form.due_date || null) : null,
        assigned_to: type === 'chamado' ? (form.assigned_to || null) : null,
        event_date: type === 'evento' ? (form.event_date ? new Date(form.event_date).toISOString() : null) : null,
        location: type === 'evento' ? (form.location || null) : null,
      }
      let res
      if (isEdit) {
        payload.status = form.status
        res = await api.put(`/demands/${demand.id}`, payload)
      } else {
        res = await api.post('/demands', { type, ...payload })
      }
      onSaved?.(res.data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const removeDemand = async () => {
    setDeleting(true)
    setError('')
    try {
      await api.delete(`/demands/${demand.id}`)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao excluir.')
      setDeleting(false)
    }
  }

  const addComment = async () => {
    if (!comment.trim() || !demand?.id) return
    try {
      const { data } = await api.post(`/demands/${demand.id}/comments`, { content: comment })
      setDetail(d => ({ ...(d || {}), comments: [...((d && d.comments) || []), data] }))
      setComment('')
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao comentar.')
    }
  }

  const deleteComment = async (id) => {
    try {
      await api.delete(`/demands/${demand.id}/comments/${id}`)
      setDetail(d => ({ ...(d || {}), comments: (d.comments || []).filter(c => c.id !== id) }))
    } catch {}
  }

  const title = isEdit
    ? (type === 'chamado' ? 'Chamado' : 'Evento')
    : (type === 'chamado' ? 'Novo chamado' : 'Novo evento')

  const comments = detail?.comments || []
  const activities = detail?.activities || []

  return (
    <Modal title={title} onClose={onClose} width={620}>
      <div className={s.body}>
        {error && <div className={s.errorBox}>⚠ {error}</div>}

        <div className="form-group">
          <label className="label">Título *</label>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder={type === 'chamado' ? 'Ex: Solicitação de manutenção...' : 'Ex: Reunião de planejamento...'}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="label">Descrição</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Detalhes..."
          />
        </div>

        <div className={s.row}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="label">Setor {type === 'chamado' ? 'destino' : 'responsável'}{type === 'chamado' ? ' *' : ''}</label>
            <select
              value={form.department_id}
              onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
            >
              <option value="">— Selecionar setor</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {isEdit && (
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {type === 'chamado' && (
          <>
            <div className={s.row}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label">Prioridade</label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                >
                  {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label">Prazo</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-group" ref={assigneeBoxRef} style={{ position: 'relative' }}>
              <label className="label">Responsável</label>
              <div className={s.assigneeInputWrap}>
                <input
                  placeholder="Buscar por nome ou e-mail..."
                  value={assigneeQuery}
                  onChange={e => { setAssigneeQuery(e.target.value); setForm(f => ({ ...f, assigned_to: '' })) }}
                  onFocus={() => assigneeResults.length > 0 && setShowAssigneeDrop(true)}
                  autoComplete="off"
                />
                {(form.assigned_to || assigneeQuery) && (
                  <button type="button" className={s.clearBtn} onClick={clearAssignee} title="Limpar">✕</button>
                )}
              </div>
              {showAssigneeDrop && assigneeResults.length > 0 && (
                <div className={s.dropdown}>
                  {assigneeResults.map(u => (
                    <button key={u.id} type="button" className={s.dropdownItem} onClick={() => selectAssignee(u)}>
                      <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{u.name?.charAt(0)}</span>
                      <span className={s.dropdownMeta}>
                        <span className={s.dropdownName}>{u.name}</span>
                        <span className={s.dropdownEmail}>{u.email}</span>
                      </span>
                      {u.department_name && <span className="badge badge-blue">{u.department_name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {type === 'evento' && (
          <div className={s.row}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Data e hora *</label>
              <input
                type="datetime-local"
                value={form.event_date}
                onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Local</label>
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Ex: Sala de reuniões..."
              />
            </div>
          </div>
        )}

        <div className={s.footer}>
          {isEdit && (
            confirmDelete ? (
              <div className={s.confirmBox}>
                <span>Excluir permanentemente?</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                <button className="btn btn-danger btn-sm" onClick={removeDemand} disabled={deleting}>
                  {deleting ? 'Excluindo...' : 'Confirmar exclusão'}
                </button>
              </div>
            ) : (
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Excluir</button>
            )
          )}
          <div className={s.footerRight}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar'}
            </button>
          </div>
        </div>

        {isEdit && (
          <>
            <div className={s.divider} />

            {loadingDetail ? (
              <p className={s.mutedText}>Carregando comentários e histórico...</p>
            ) : (
              <>
                <div className={s.section}>
                  <h4 className={s.sectionTitle}>Comentários {comments.length > 0 && `(${comments.length})`}</h4>
                  <div className={s.comments}>
                    {comments.length === 0 && <p className={s.mutedText}>Nenhum comentário ainda.</p>}
                    {comments.map(c => (
                      <div key={c.id} className={s.comment}>
                        <div className={s.commentAvatar}>{c.user_name?.charAt(0)}</div>
                        <div className={s.commentBody}>
                          <div className={s.commentHeader}>
                            <strong>{c.user_name}</strong>
                            <span className={s.mutedSmall}>
                              {new Date(c.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {c.user_name === user?.name && (
                              <button className="btn btn-icon" style={{ width: 22, height: 22, fontSize: 10, marginLeft: 'auto' }}
                                onClick={() => deleteComment(c.id)}>✕</button>
                            )}
                          </div>
                          <p>{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={s.addComment}>
                    <textarea
                      rows={2}
                      placeholder="Escreva um comentário..."
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }}
                    />
                    <button className="btn btn-primary btn-sm" onClick={addComment} disabled={!comment.trim()}>Enviar</button>
                  </div>
                </div>

                <div className={s.section}>
                  <h4 className={s.sectionTitle}>Histórico</h4>
                  {activities.length === 0 ? (
                    <p className={s.mutedText}>Nenhuma atividade registrada.</p>
                  ) : (
                    <div className={s.activities}>
                      {activities.map(a => (
                        <div key={a.id} className={s.activity}>
                          <strong>{a.user_name}</strong> <span>{a.action}</span>
                          {a.details && <span className={s.mutedSmall}> · {a.details}</span>}
                          <span className={s.mutedSmall} style={{ marginLeft: 8 }}>
                            {new Date(a.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
