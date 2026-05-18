import { useState, useEffect } from 'react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import s from './CardModal.module.css'

const PRIORITY_OPTIONS = [{ value:'high', label:'🔴 Alta' }, { value:'medium', label:'🟡 Média' }, { value:'low', label:'🟢 Baixa' }]

export default function CardModal({ cardId, pipeId, phases, fields, members, labels, allowedAssignees, onClose, onUpdate, onArchive, onDelete }) {
  const [card, setCard] = useState(null)
  const [tab, setTab] = useState('details')
  const [saving, setSaving] = useState(false)
  const [comment, setComment] = useState('')
  const [newItem, setNewItem] = useState('')
  const { user } = useAuthStore()

  const load = () => api.get(`/pipes/${pipeId}/cards/${cardId}`).then(r => setCard(r.data))
  useEffect(() => { load() }, [cardId])

  if (!card) return (
    <div className={s.overlay}>
      <div className={s.modal}><div className={s.loading}>Carregando...</div></div>
    </div>
  )

  const update = async (patch) => {
    setSaving(true)
    const { data } = await api.put(`/pipes/${pipeId}/cards/${cardId}`, { ...card, ...patch })
    setCard(c => ({ ...c, ...patch }))
    onUpdate(data)
    setSaving(false)
  }

  const saveField = async (fieldId, value) => {
    await api.put(`/pipes/${pipeId}/cards/${cardId}/fields`, { fields: [{ field_id: fieldId, value }] })
    setCard(c => ({
      ...c,
      fields: c.fields.map(f => f.field_id === fieldId ? { ...f, value } : f)
    }))
  }

  const addComment = async () => {
    if (!comment.trim()) return
    const { data } = await api.post(`/pipes/${pipeId}/cards/${cardId}/comments`, { content: comment })
    setCard(c => ({ ...c, comments: [...(c.comments || []), data] }))
    setComment('')
  }

  const deleteComment = async (id) => {
    await api.delete(`/pipes/${pipeId}/cards/${cardId}/comments/${id}`)
    setCard(c => ({ ...c, comments: c.comments.filter(cm => cm.id !== id) }))
  }

  const addChecklist = async () => {
    if (!newItem.trim()) return
    const { data } = await api.post(`/pipes/${pipeId}/cards/${cardId}/checklist`, { title: newItem })
    setCard(c => ({ ...c, checklist: [...(c.checklist || []), data] }))
    setNewItem('')
  }

  const toggleChecklist = async (item) => {
    await api.put(`/pipes/${pipeId}/cards/${cardId}/checklist/${item.id}`, { done: item.done ? 0 : 1, title: item.title })
    setCard(c => ({ ...c, checklist: c.checklist.map(i => i.id === item.id ? { ...i, done: i.done ? 0 : 1 } : i) }))
  }

  const removeChecklist = async (id) => {
    await api.delete(`/pipes/${pipeId}/cards/${cardId}/checklist/${id}`)
    setCard(c => ({ ...c, checklist: c.checklist.filter(i => i.id !== id) }))
  }

  const archiveCard = async () => {
    await api.post(`/pipes/${pipeId}/cards/${cardId}/archive`)
    onArchive(cardId)
    onClose()
  }

  const cardLabels = (() => { try { return JSON.parse(card.labels || '[]') } catch { return [] } })()
  const checklist = card.checklist || []
  const doneCount = checklist.filter(i => i.done).length

  const toggleLabel = async (labelId) => {
    const current = cardLabels
    const updated = current.includes(labelId) ? current.filter(l => l !== labelId) : [...current, labelId]
    const labelsJson = JSON.stringify(updated)
    await api.put(`/pipes/${pipeId}/cards/${cardId}`, { ...card, labels: labelsJson })
    setCard(c => ({ ...c, labels: labelsJson }))
  }

  return (
    <div className={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        {/* Header */}
        <div className={s.header}>
          <div className={s.headerLeft}>
            <select className={s.phaseSelect} value={card.phase_id} onChange={e => update({ phase_id: e.target.value })}>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className={s.prioritySelect} value={card.priority} onChange={e => update({ priority: e.target.value })}>
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-sm btn-ghost" onClick={archiveCard}>📦 Arquivar</button>
            <button className="btn btn-sm btn-danger" onClick={() => { if(confirm('Excluir este card?')) onDelete(cardId) }}>🗑️</button>
            <button className="btn btn-icon" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Title */}
        <div className={s.body}>
          <textarea className={s.titleInput} value={card.title}
            onChange={e => setCard(c => ({ ...c, title: e.target.value }))}
            onBlur={e => update({ title: e.target.value })}
            rows={2} />

          <div className={s.meta}>
            {/* Assignee / Approver */}
            <div className={s.metaField}>
              <span className="label" title="Quem vai ver e aprovar este card">
                📤 Encaminhar para
                {allowedAssignees && (
                  <span style={{ fontSize:10, color:'#f59e0b', background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.2)', borderRadius:20, padding:'1px 7px', marginLeft:6, fontWeight:700 }}>
                    🔒 restrito
                  </span>
                )}
              </span>
              <select value={card.assignee_id || ''} onChange={e => update({ assignee_id: e.target.value || null })} style={{ width:'auto' }}>
                <option value="">— Selecionar aprovador</option>
                {(allowedAssignees
                  ? members.filter(m => allowedAssignees.some(a => a.id === m.id))
                  : members
                ).map(m => <option key={m.id} value={m.id}>{m.name}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
              </select>
            </div>
            {/* Due date */}
            <div className={s.metaField}>
              <span className="label">Data Limite</span>
              <input type="date" value={card.due_date || ''} onChange={e => update({ due_date: e.target.value || null })} style={{ width:'auto' }} />
            </div>
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div className={s.section}>
              <span className="label">Etiquetas</span>
              <div className={s.labelsWrap}>
                {labels.map(l => (
                  <button key={l.id} onClick={() => toggleLabel(l.id)}
                    className={`${s.labelChip} ${cardLabels.includes(l.id) ? s.labelActive : ''}`}
                    style={{ '--lc': l.color }}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className={s.tabs}>
            {['details','checklist','comments','activity'].map(t => (
              <button key={t} className={`${s.tab} ${tab === t ? s.activeTab : ''}`} onClick={() => setTab(t)}>
                {{ details:'📋 Campos', checklist:'☑️ Checklist', comments:'💬 Comentários', activity:'📜 Atividade' }[t]}
              </button>
            ))}
          </div>

          {/* Tab: Fields */}
          {tab === 'details' && (
            <div className={s.fields}>
              {fields.map(field => {
                const cf = card.fields?.find(f => f.field_id === field.id)
                const value = cf?.value || ''
                return (
                  <div key={field.id} className="form-group">
                    <label className="label">{field.name}{field.required ? ' *' : ''}</label>
                    {field.type === 'textarea' ? (
                      <textarea rows={3} defaultValue={value} onBlur={e => saveField(field.id, e.target.value)} />
                    ) : field.type === 'select' ? (
                      <select defaultValue={value} onChange={e => saveField(field.id, e.target.value)}>
                        <option value="">Selecionar...</option>
                        {JSON.parse(field.options || '[]').map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="checkbox" checked={value === 'true'} onChange={e => saveField(field.id, e.target.checked.toString())} style={{ width:16, height:16 }} />
                        <span>Sim</span>
                      </label>
                    ) : (
                      <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        defaultValue={value} onBlur={e => saveField(field.id, e.target.value)} />
                    )}
                  </div>
                )
              })}
              {fields.length === 0 && <p style={{ color:'var(--muted)', fontSize:13 }}>Nenhum campo configurado. Acesse Configurações para adicionar.</p>}
            </div>
          )}

          {/* Tab: Checklist */}
          {tab === 'checklist' && (
            <div>
              {checklist.length > 0 && (
                <div className={s.progress}>
                  <div className={s.progressBar}>
                    <div className={s.progressFill} style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
                  </div>
                  <span className={s.progressText}>{doneCount}/{checklist.length}</span>
                </div>
              )}
              <div className={s.checklistItems}>
                {checklist.map(item => (
                  <div key={item.id} className={s.checkItem}>
                    <input type="checkbox" checked={!!item.done} onChange={() => toggleChecklist(item)}
                      style={{ width:16, height:16, flexShrink:0 }} />
                    <span style={{ flex:1, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--muted)' : 'var(--white)' }}>{item.title}</span>
                    <button className="btn btn-icon btn-sm" onClick={() => removeChecklist(item.id)}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                <input placeholder="Novo item..." value={newItem} onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addChecklist()} />
                <button className="btn btn-primary btn-sm" onClick={addChecklist}>+</button>
              </div>
            </div>
          )}

          {/* Tab: Comments */}
          {tab === 'comments' && (
            <div>
              <div className={s.comments}>
                {(card.comments || []).map(c => (
                  <div key={c.id} className={s.comment}>
                    <div className="avatar" style={{ background:'#4a7cf7', fontSize:11, flexShrink:0 }}>{c.user_name?.charAt(0)}</div>
                    <div className={s.commentBody}>
                      <div className={s.commentHeader}>
                        <strong>{c.user_name}</strong>
                        <span>{new Date(c.created_at).toLocaleString('pt-BR')}</span>
                        {c.user_id === user?.id && (
                          <button className="btn btn-icon btn-sm" onClick={() => deleteComment(c.id)}>✕</button>
                        )}
                      </div>
                      <p>{c.content}</p>
                    </div>
                  </div>
                ))}
                {(card.comments || []).length === 0 && <p style={{ color:'var(--muted)', fontSize:13 }}>Nenhum comentário ainda.</p>}
              </div>
              <div style={{ display:'flex', gap:6, marginTop:12 }}>
                <textarea rows={2} placeholder="Escreva um comentário..." value={comment} onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }} />
                <button className="btn btn-primary" style={{ alignSelf:'flex-end' }} onClick={addComment}>→</button>
              </div>
            </div>
          )}

          {/* Tab: Activity */}
          {tab === 'activity' && (
            <div className={s.activities}>
              {(card.activities || []).map(a => (
                <div key={a.id} className={s.activity}>
                  <div className="avatar" style={{ width:28, height:28, fontSize:10, background:'#4a7cf7', flexShrink:0 }}>{a.user_name?.charAt(0)}</div>
                  <div>
                    <span className={s.actUser}>{a.user_name}</span>
                    <span className={s.actDetails}> {a.details}</span>
                    <div className={s.actTime}>{new Date(a.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
