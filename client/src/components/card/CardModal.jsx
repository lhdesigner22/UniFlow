import { useState, useEffect } from 'react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import s from './CardModal.module.css'

const PRIORITY = {
  high:   { label: 'Alta',  color: '#ef4444', dot: '🔴' },
  medium: { label: 'Média', color: '#f59e0b', dot: '🟡' },
  low:    { label: 'Baixa', color: '#22c55e', dot: '🟢' },
}

const TABS = [
  { key: 'details',   label: 'Campos' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'comments',  label: 'Comentários' },
  { key: 'activity',  label: 'Histórico' },
]

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
      <div className={s.modal}>
        <div className={s.loading}>
          <span className={s.loadingSpinner} />
          Carregando...
        </div>
      </div>
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
    setCard(c => ({ ...c, fields: c.fields.map(f => f.field_id === fieldId ? { ...f, value } : f) }))
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
  const checklist  = card.checklist || []
  const doneCount  = checklist.filter(i => i.done).length
  const phaseName  = phases.find(p => p.id === card.phase_id)?.name || '—'

  const toggleLabel = async (labelId) => {
    const updated = cardLabels.includes(labelId)
      ? cardLabels.filter(l => l !== labelId)
      : [...cardLabels, labelId]
    const labelsJson = JSON.stringify(updated)
    await api.put(`/pipes/${pipeId}/cards/${cardId}`, { ...card, labels: labelsJson })
    setCard(c => ({ ...c, labels: labelsJson }))
  }

  const assignees = allowedAssignees
    ? members.filter(m => allowedAssignees.some(a => a.id === m.id))
    : members

  return (
    <div className={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>

        {/* ── Header ── */}
        <div className={s.header}>
          <div className={s.breadcrumb}>
            <span className={s.breadcrumbPhase}
              style={{ color: phases.find(p => p.id === card.phase_id)?.color || 'var(--blue)' }}>
              ● {phaseName}
            </span>
            <span className={s.breadcrumbSep}>›</span>
            <span className={s.breadcrumbTitle}>{card.title?.slice(0, 60)}{card.title?.length > 60 ? '…' : ''}</span>
          </div>
          <div className={s.headerRight}>
            {saving && <span className={s.savingPill}>Salvando…</span>}
            <button className="btn btn-icon" onClick={onClose} title="Fechar (Esc)">✕</button>
          </div>
        </div>

        {/* ── Two-panel body ── */}
        <div className={s.panels}>

          {/* ── Main panel ── */}
          <div className={s.mainPanel}>
            <textarea
              className={s.titleInput}
              value={card.title}
              onChange={e => setCard(c => ({ ...c, title: e.target.value }))}
              onBlur={e => update({ title: e.target.value })}
              rows={2}
              placeholder="Título do card..."
            />

            {/* Tab bar */}
            <div className={s.tabs}>
              {TABS.map(t => (
                <button
                  key={t.key}
                  className={`${s.tab} ${tab === t.key ? s.activeTab : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === 'checklist' && checklist.length > 0 && (
                    <span className={s.tabBadge}>{doneCount}/{checklist.length}</span>
                  )}
                  {t.key === 'comments' && (card.comments || []).length > 0 && (
                    <span className={s.tabBadge}>{(card.comments || []).length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className={s.tabContent}>

              {/* Fields */}
              {tab === 'details' && (
                <div className={s.fields}>
                  {fields.length === 0 && (
                    <div className={s.emptyTab}>
                      <span>⊞</span>
                      <p>Nenhum campo configurado.<br />Acesse Configurações do pipe para adicionar campos.</p>
                    </div>
                  )}
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
                          <label className={s.checkboxLabel}>
                            <input type="checkbox" checked={value === 'true'} onChange={e => saveField(field.id, e.target.checked.toString())} />
                            <span>Sim</span>
                          </label>
                        ) : (
                          <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            defaultValue={value} onBlur={e => saveField(field.id, e.target.value)} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Checklist */}
              {tab === 'checklist' && (
                <div className={s.checklistWrap}>
                  {checklist.length > 0 && (
                    <div className={s.progress}>
                      <div className={s.progressBar}>
                        <div className={s.progressFill} style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
                      </div>
                      <span className={s.progressText}>{Math.round((doneCount / checklist.length) * 100)}%</span>
                    </div>
                  )}
                  <div className={s.checklistItems}>
                    {checklist.map(item => (
                      <div key={item.id} className={`${s.checkItem} ${item.done ? s.checkDone : ''}`}>
                        <input type="checkbox" checked={!!item.done} onChange={() => toggleChecklist(item)} className={s.checkbox} />
                        <span className={s.checkTitle}>{item.title}</span>
                        <button className="btn btn-icon" style={{ width:24, height:24, fontSize:11 }} onClick={() => removeChecklist(item.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                  {checklist.length === 0 && (
                    <div className={s.emptyTab}>
                      <span>✓</span>
                      <p>Nenhum item ainda. Adicione abaixo.</p>
                    </div>
                  )}
                  <div className={s.addRow}>
                    <input placeholder="Novo item do checklist..." value={newItem}
                      onChange={e => setNewItem(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addChecklist()} />
                    <button className="btn btn-primary btn-sm" onClick={addChecklist}>Adicionar</button>
                  </div>
                </div>
              )}

              {/* Comments */}
              {tab === 'comments' && (
                <div className={s.commentsWrap}>
                  <div className={s.comments}>
                    {(card.comments || []).length === 0 && (
                      <div className={s.emptyTab}>
                        <span>💬</span>
                        <p>Nenhum comentário ainda. Seja o primeiro!</p>
                      </div>
                    )}
                    {(card.comments || []).map(c => (
                      <div key={c.id} className={s.comment}>
                        <div className={s.commentAvatar}>{c.user_name?.charAt(0)}</div>
                        <div className={s.commentBody}>
                          <div className={s.commentHeader}>
                            <strong className={s.commentAuthor}>{c.user_name}</strong>
                            <span className={s.commentTime}>
                              {new Date(c.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                            </span>
                            {c.user_id === user?.id && (
                              <button className="btn btn-icon" style={{ width:22, height:22, fontSize:10, marginLeft:'auto' }} onClick={() => deleteComment(c.id)}>✕</button>
                            )}
                          </div>
                          <p className={s.commentText}>{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={s.commentInput}>
                    <div className={s.commentAvatar} style={{ flexShrink:0 }}>{user?.name?.charAt(0)}</div>
                    <div className={s.commentInputWrap}>
                      <textarea rows={2} placeholder="Escreva um comentário... (Enter para enviar)"
                        value={comment} onChange={e => setComment(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }} />
                      <button className="btn btn-primary btn-sm" onClick={addComment} disabled={!comment.trim()}>Enviar</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Activity */}
              {tab === 'activity' && (
                <div className={s.activities}>
                  {(card.activities || []).length === 0 && (
                    <div className={s.emptyTab}>
                      <span>⏱</span>
                      <p>Nenhuma atividade registrada.</p>
                    </div>
                  )}
                  {(card.activities || []).map(a => (
                    <div key={a.id} className={s.activity}>
                      <div className={s.actAvatar}>{a.user_name?.charAt(0)}</div>
                      <div className={s.actBody}>
                        <p><strong className={s.actUser}>{a.user_name}</strong> <span className={s.actDetails}>{a.details}</span></p>
                        <span className={s.actTime}>
                          {new Date(a.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>

          {/* ── Side panel ── */}
          <div className={s.sidePanel}>

            <div className={s.metaGroup}>
              <span className="label">Fase</span>
              <select value={card.phase_id} onChange={e => update({ phase_id: e.target.value })}>
                {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className={s.metaGroup}>
              <span className="label">Prioridade</span>
              <div className={s.priorityBtns}>
                {Object.entries(PRIORITY).map(([key, p]) => (
                  <button
                    key={key}
                    className={`${s.priorityBtn} ${card.priority === key ? s.priorityActive : ''}`}
                    style={{ '--pc': p.color }}
                    onClick={() => update({ priority: key })}
                  >
                    <span style={{ color: p.color }}>●</span> {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.metaGroup}>
              <span className="label">
                Encaminhar para
                {allowedAssignees && (
                  <span className={s.restrictedBadge}>🔒 restrito</span>
                )}
              </span>
              <select value={card.assignee_id || ''} onChange={e => update({ assignee_id: e.target.value || null })}>
                <option value="">— Sem aprovador</option>
                {assignees.map(m => <option key={m.id} value={m.id}>{m.name}{m.role === 'admin' ? ' ★' : ''}</option>)}
              </select>
            </div>

            <div className={s.metaGroup}>
              <span className="label">Data Limite</span>
              <input type="date" value={card.due_date || ''} onChange={e => update({ due_date: e.target.value || null })} />
            </div>

            {labels.length > 0 && (
              <div className={s.metaGroup}>
                <span className="label">Etiquetas</span>
                <div className={s.labelsWrap}>
                  {labels.map(l => (
                    <button
                      key={l.id}
                      onClick={() => toggleLabel(l.id)}
                      className={`${s.labelChip} ${cardLabels.includes(l.id) ? s.labelActive : ''}`}
                      style={{ '--lc': l.color }}
                    >
                      {cardLabels.includes(l.id) ? '✓ ' : ''}{l.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={s.sideDivider} />

            <div className={s.sideActions}>
              <button className="btn btn-ghost btn-sm" style={{ width:'100%', justifyContent:'center' }} onClick={archiveCard}>
                Arquivar card
              </button>
              <button className="btn btn-danger btn-sm" style={{ width:'100%', justifyContent:'center' }}
                onClick={() => { if (confirm('Excluir este card permanentemente?')) onDelete(cardId) }}>
                Excluir card
              </button>
            </div>

            <div className={s.sideFooter}>
              <span>Criado por {card.created_by_name}</span>
              <span>{new Date(card.created_at).toLocaleDateString('pt-BR')}</span>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
