import { useState, useEffect } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import MemberPicker from '../common/MemberPicker'
import { avatarColor } from '../../utils/avatarColor'
import { formatDuration, hhmmToSeconds, secondsToHHMM, parseDbTimestamp, todayLocalISO } from '../../utils/formatDuration'
import { confirmDialog } from '../../store/dialogStore'
import LineIcon from '../common/LineIcon'
import s from './CardModal.module.css'

// Foto dentro de um "chip" (membro/lançamento de tempo/comentário) — cai
// pra inicial se a imagem falhar ao carregar (bloqueio de extensão,
// link expirado etc.) em vez de deixar um ícone de imagem quebrada.
function ChipAvatar({ id, name, photo, style }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={s.chipDot} style={{ background: avatarColor(id), ...style }}>
      {photo && !failed
        ? <img src={photo} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={s.chipPhoto} />
        : name?.charAt(0).toUpperCase()}
    </span>
  )
}

const PRIORITIES = [
  { value: '', label: 'Nenhuma' },
  { value: 'baixa', label: 'Baixa' },
  { value: 'media', label: 'Média' },
  { value: 'alta', label: 'Alta' },
]

// Status do cartão, no estilo Planner — independente da coluna/quadro em
// que ele está (a coluna já é escolhida acima, no seletor "Coluna").
const PROGRESS_OPTIONS = [
  { value: 'not_started', label: 'Não iniciado' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'completed', label: 'Concluído' },
]

// Cores prontas pras etiquetas do quadro (o servidor só aceita #RRGGBB).
const LABEL_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#0EA5A5', '#3B82F6', '#8B5CF6', '#EC4899', '#64748B']

function fmtDateTime(v) {
  // Timestamps do backend vêm em UTC sem sufixo 'Z' — parseDbTimestamp trata
  // isso corretamente (ver esse helper pra mais contexto).
  return parseDbTimestamp(v).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CardModal({ boardId, cardId, board, currentUser, onClose, onPatchLocal, onDeleted, onBoardLabelsChange }) {
  // Formulário de etiqueta do quadro: null = fechado; { id?, name, color } = criando (sem id) ou editando
  const [labelForm, setLabelForm] = useState(null)
  const [editingLabels, setEditingLabels] = useState(false)
  const [labelError, setLabelError] = useState('')
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(null)
  const [tick, setTick] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [showMemberPicker, setShowMemberPicker] = useState(false)
  const [newChecklistTitle, setNewChecklistTitle] = useState('')
  const [newComment, setNewComment] = useState('')
  const [manualTime, setManualTime] = useState({ duration: '', note: '', date: todayLocalISO() })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [starting, setStarting] = useState(false)

  const patch = (updater) => setCard(prev => {
    const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
    onPatchLocal?.(cardId, next)
    return next
  })

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get(`/boards/${boardId}/cards/${cardId}`),
      api.get('/time/running'),
    ]).then(([c, r]) => {
      setCard(c.data)
      setTitleDraft(c.data.title || '')
      setDescDraft(c.data.description || '')
      setRunning(r.data || null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [cardId])

  const runningHere = running && running.card_id === cardId
  useEffect(() => {
    if (!runningHere) return
    const t = setInterval(() => setTick(v => v + 1), 1000)
    return () => clearInterval(t)
  }, [runningHere])

  if (loading || !card) {
    return (
      <Modal title="Carregando..." onClose={onClose} width={760}>
        <div className={s.loading}>Carregando cartão...</div>
      </Modal>
    )
  }

  // ── Title / description ──────────────────────────────────────
  const saveTitle = async () => {
    if (!titleDraft.trim() || titleDraft === card.title) { setTitleDraft(card.title); return }
    const { data } = await api.put(`/boards/${boardId}/cards/${cardId}`, { title: titleDraft.trim() })
    patch(prev => ({ ...prev, ...data }))
  }
  const saveDescription = async () => {
    if (descDraft === card.description) return
    const { data } = await api.put(`/boards/${boardId}/cards/${cardId}`, { description: descDraft })
    patch(prev => ({ ...prev, ...data }))
  }

  // ── Due date / priority ──────────────────────────────────────
  const updateField = async (field, value) => {
    const { data } = await api.put(`/boards/${boardId}/cards/${cardId}`, { [field]: value || null })
    patch(prev => ({ ...prev, ...data }))
  }

  // ── Coluna (mesma rota usada pelo drag-and-drop do board) ─────
  const moveToColumn = async (columnId) => {
    if (!columnId || columnId === card.column_id) return
    await api.post(`/boards/${boardId}/cards/${cardId}/move`, { column_id: columnId })
    patch(prev => ({ ...prev, column_id: columnId }))
  }

  // ── Labels ────────────────────────────────────────────────────
  const toggleLabel = async (label) => {
    const has = card.labels?.some(l => l.id === label.id)
    if (has) {
      await api.delete(`/boards/${boardId}/cards/${cardId}/labels/${label.id}`)
      patch(prev => ({ ...prev, labels: prev.labels.filter(l => l.id !== label.id) }))
    } else {
      await api.post(`/boards/${boardId}/cards/${cardId}/labels`, { label_id: label.id })
      patch(prev => ({ ...prev, labels: [...(prev.labels || []), label] }))
    }
  }

  // Etiquetas do QUADRO (criar/editar/apagar) — valem pra todos os cartões dele.
  const boardLabels = board.labels || []
  const saveLabelForm = async () => {
    const name = labelForm?.name.trim()
    if (!name) return
    setLabelError('')
    try {
      if (labelForm.id) {
        const { data } = await api.put(`/boards/${boardId}/labels/${labelForm.id}`, { name, color: labelForm.color })
        onBoardLabelsChange?.(boardLabels.map(l => l.id === data.id ? data : l))
        patch(prev => ({ ...prev, labels: (prev.labels || []).map(l => l.id === data.id ? data : l) }))
      } else {
        const { data } = await api.post(`/boards/${boardId}/labels`, { name, color: labelForm.color })
        onBoardLabelsChange?.([...boardLabels, data])
        // Quem cria a etiqueta de dentro de um cartão quase sempre quer ela nesse cartão.
        await api.post(`/boards/${boardId}/cards/${cardId}/labels`, { label_id: data.id })
        patch(prev => ({ ...prev, labels: [...(prev.labels || []), data] }))
      }
      setLabelForm(null)
    } catch (e) {
      setLabelError(e.response?.data?.error || 'Não deu pra salvar a etiqueta.')
    }
  }
  const deleteLabel = async (label) => {
    const ok = await confirmDialog(`Apagar a etiqueta "${label.name}"? Ela sai de todos os cartões deste quadro.`, { title: 'Apagar etiqueta', confirmLabel: 'Apagar' })
    if (!ok) return
    await api.delete(`/boards/${boardId}/labels/${label.id}`)
    onBoardLabelsChange?.(boardLabels.filter(l => l.id !== label.id), { reload: true })
    patch(prev => ({ ...prev, labels: (prev.labels || []).filter(l => l.id !== label.id) }))
    if (labelForm?.id === label.id) setLabelForm(null)
  }

  // ── Members ───────────────────────────────────────────────────
  const addMember = async (u) => {
    await api.post(`/boards/${boardId}/cards/${cardId}/members`, { user_id: u.id })
    patch(prev => ({ ...prev, members: [...(prev.members || []), u] }))
    setShowMemberPicker(false)
  }
  const removeMember = async (userId) => {
    await api.delete(`/boards/${boardId}/cards/${cardId}/members/${userId}`)
    patch(prev => ({ ...prev, members: prev.members.filter(m => m.id !== userId) }))
  }

  // ── Checklist ─────────────────────────────────────────────────
  const addChecklistItem = async () => {
    if (!newChecklistTitle.trim()) return
    const { data } = await api.post(`/boards/${boardId}/cards/${cardId}/checklist`, { title: newChecklistTitle.trim() })
    patch(prev => ({ ...prev, checklist: [...(prev.checklist || []), data] }))
    setNewChecklistTitle('')
  }
  const toggleChecklistItem = async (item) => {
    const done = item.done ? 0 : 1
    await api.put(`/boards/${boardId}/cards/${cardId}/checklist/${item.id}`, { title: item.title, done })
    patch(prev => ({ ...prev, checklist: prev.checklist.map(i => i.id === item.id ? { ...i, done } : i) }))
  }
  const deleteChecklistItem = async (item) => {
    await api.delete(`/boards/${boardId}/cards/${cardId}/checklist/${item.id}`)
    patch(prev => ({ ...prev, checklist: prev.checklist.filter(i => i.id !== item.id) }))
  }

  // ── Time tracking ────────────────────────────────────────────
  const startTimer = async () => {
    setStarting(true)
    try {
      await api.post(`/cards/${cardId}/time/start`)
      const { data } = await api.get('/time/running')
      setRunning(data || null)
    } finally { setStarting(false) }
  }
  const stopTimer = async () => {
    const { data } = await api.post(`/cards/${cardId}/time/stop`)
    setRunning(null)
    const { data: fresh } = await api.get(`/boards/${boardId}/cards/${cardId}`)
    patch(() => fresh)
  }
  const submitManualTime = async () => {
    const seconds = hhmmToSeconds(manualTime.duration)
    if (!seconds) return
    const { data } = await api.post(`/cards/${cardId}/time`, {
      duration_seconds: seconds, note: manualTime.note || null, date: manualTime.date,
    })
    patch(prev => ({
      ...prev,
      time_entries: [data, ...(prev.time_entries || [])],
      total_seconds: (prev.total_seconds || 0) + seconds,
    }))
    setManualTime({ duration: '', note: '', date: todayLocalISO() })
  }
  const deleteTimeEntry = async (entry) => {
    await api.delete(`/time/${entry.id}`)
    patch(prev => ({
      ...prev,
      time_entries: prev.time_entries.filter(e => e.id !== entry.id),
      total_seconds: Math.max(0, (prev.total_seconds || 0) - (entry.duration_seconds || 0)),
    }))
  }

  // ── Comments ──────────────────────────────────────────────────
  const addComment = async () => {
    if (!newComment.trim()) return
    const { data } = await api.post(`/boards/${boardId}/cards/${cardId}/comments`, { content: newComment.trim() })
    patch(prev => ({ ...prev, comments: [...(prev.comments || []), data] }))
    setNewComment('')
  }
  const deleteComment = async (id) => {
    await api.delete(`/boards/${boardId}/cards/${cardId}/comments/${id}`)
    patch(prev => ({ ...prev, comments: prev.comments.filter(c => c.id !== id) }))
  }

  // ── Delete card ───────────────────────────────────────────────
  const deleteCard = async () => {
    await api.delete(`/boards/${boardId}/cards/${cardId}`)
    onDeleted?.()
  }

  const checklist = card.checklist || []
  const checklistDone = checklist.filter(i => i.done).length
  const checklistPct = checklist.length ? Math.round((checklistDone / checklist.length) * 100) : 0

  const liveElapsed = runningHere ? Math.max(0, Math.floor((Date.now() - parseDbTimestamp(running.started_at).getTime()) / 1000)) : 0
  const grandTotal = (card.total_seconds || 0) + liveElapsed

  const columnName = (board.columns || []).find(c => c.id === card.column_id)?.name
  const progress = card.progress || 'not_started'

  return (
    <Modal title="" onClose={onClose} width={980}>
      <div className={s.wrap}>
        {/* ── Título ── */}
        <div className={s.head}>
          <textarea
            rows={1}
            aria-label="Título do cartão"
            className={`${s.titleInput} ${progress === 'completed' ? s.titleCompleted : ''}`}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }}
          />
          {columnName && <p className={s.where}>Na coluna <strong>{columnName}</strong> de {board.name}</p>}
        </div>

        <div className={s.layout}>
          {/* ── Conteúdo ── */}
          <div className={s.main}>
            <section className={s.section}>
              <h3 className={s.sectionTitle}>Descrição</h3>
              <textarea className={s.desc} rows={4} value={descDraft} onChange={e => setDescDraft(e.target.value)} onBlur={saveDescription} placeholder="Detalhes, links, o que precisa ser feito..." aria-label="Descrição" />
            </section>

            <section className={s.section}>
              <div className={s.sectionHeader}>
                <h3 className={s.sectionTitle}>Checklist</h3>
                {checklist.length > 0 && <span className={s.sectionCount}>{checklistDone} de {checklist.length}</span>}
              </div>
              {checklist.length > 0 && (
                <div className={s.progressBar} role="progressbar" aria-valuenow={checklistPct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist feito">
                  <div className={s.progressFill} style={{ width: `${checklistPct}%` }} />
                </div>
              )}
              <div className={s.checklist}>
                {checklist.map(item => (
                  <label key={item.id} className={s.checklistItem}>
                    <input type="checkbox" checked={!!item.done} onChange={() => toggleChecklistItem(item)} />
                    <span className={item.done ? s.checklistDone : ''}>{item.title}</span>
                    <button type="button" className={s.itemDelete} aria-label={`Apagar "${item.title}"`} onClick={e => { e.preventDefault(); deleteChecklistItem(item) }}><LineIcon name="close" /></button>
                  </label>
                ))}
              </div>
              <div className={s.addRow}>
                <input placeholder="Novo item do checklist" aria-label="Novo item do checklist" value={newChecklistTitle} onChange={e => setNewChecklistTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addChecklistItem()} />
                <button className="btn btn-ghost btn-sm" onClick={addChecklistItem} disabled={!newChecklistTitle.trim()}>Adicionar item</button>
              </div>
            </section>

            <section className={s.section}>
              <h3 className={s.sectionTitle}>Comentários</h3>
              <div className={s.commentList}>
                {(card.comments || []).map(c => (
                  <div key={c.id} className={s.commentRow}>
                    <ChipAvatar id={c.user_id || c.id} name={c.user_name} photo={c.avatar} style={{ width: 28, height: 28, fontSize: 11 }} />
                    <div className={s.commentBody}>
                      <div className={s.commentMeta}><strong>{c.user_name}</strong><span>{fmtDateTime(c.created_at)}</span></div>
                      <div className={s.commentText}>{c.content}</div>
                    </div>
                    {c.user_id === currentUser?.id && <button type="button" className={s.itemDelete} aria-label="Apagar comentário" onClick={() => deleteComment(c.id)}><LineIcon name="close" /></button>}
                  </div>
                ))}
                {!(card.comments || []).length && <p className={s.emptyHint}>Nenhum comentário ainda.</p>}
              </div>
              <div className={s.addRow}>
                <input placeholder="Escreva um comentário" aria-label="Novo comentário" value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} />
                <button className="btn btn-primary btn-sm" onClick={addComment} disabled={!newComment.trim()}><LineIcon name="send" /> Comentar</button>
              </div>
            </section>

            {card.activities?.length > 0 && (
              <details className={s.activity}>
                <summary>Histórico do cartão ({card.activities.length})</summary>
                <div className={s.activityList}>
                  {card.activities.map(a => (
                    <div key={a.id} className={s.activityRow}>
                      <span>{a.action}{a.details ? `: ${a.details}` : ''}</span>
                      <span className={s.activityMeta}>{a.user_name}, {fmtDateTime(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* ── Propriedades ── */}
          <aside className={s.side} aria-label="Propriedades do cartão">
            <div className={s.prop}>
              <span className={s.propLabel} id="card-progress">Andamento</span>
              <div className={s.segment} role="radiogroup" aria-labelledby="card-progress">
                {PROGRESS_OPTIONS.map(p => (
                  <button key={p.value} type="button" role="radio" aria-checked={progress === p.value}
                    className={`${s.segBtn} ${progress === p.value ? s.segOn : ''}`} onClick={() => updateField('progress', p.value)}>
                    <span className={`${s.ring} ${s['ring_' + p.value]}`} aria-hidden="true" />{p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.prop}>
              <label className={s.propLabel} htmlFor="card-coluna">Coluna</label>
              <select id="card-coluna" value={card.column_id || ''} onChange={e => moveToColumn(e.target.value)}>
                {(board.columns || []).slice().sort((a, b) => a.order_index - b.order_index).map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            <div className={s.propPair}>
              <div className={s.prop}>
                <label className={s.propLabel} htmlFor="card-prazo">Prazo</label>
                <input id="card-prazo" type="date" value={card.due_date ? card.due_date.slice(0, 10) : ''} onChange={e => updateField('due_date', e.target.value)} />
              </div>
              <div className={s.prop}>
                <label className={s.propLabel} htmlFor="card-prioridade">Prioridade</label>
                <select id="card-prioridade" value={card.priority || ''} onChange={e => updateField('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className={s.prop}>
              <span className={s.propLabel}>Responsáveis</span>
              <div className={s.chipsRow}>
                {(card.members || []).map(m => (
                  <span key={m.id} className={s.chip}>
                    <ChipAvatar id={m.id} name={m.name} photo={m.avatar} />
                    {m.name}
                    <button type="button" className={s.chipRemove} aria-label={`Tirar ${m.name}`} onClick={() => removeMember(m.id)}><LineIcon name="close" /></button>
                  </span>
                ))}
                <div className={s.inviteWrap}>
                  <button type="button" className={s.addChip} onClick={() => setShowMemberPicker(v => !v)}><LineIcon name="plus" /> Adicionar</button>
                  {showMemberPicker && (
                    <MemberPicker existingIds={(card.members || []).map(m => m.id)} onPick={addMember} onClose={() => setShowMemberPicker(false)} />
                  )}
                </div>
              </div>
            </div>

            <div className={s.prop}>
              <div className={s.propHead}>
                <span className={s.propLabel}>Etiquetas</span>
                {boardLabels.length > 0 && !labelForm && (
                  <button type="button" className={s.linkBtn} onClick={() => setEditingLabels(v => !v)}>{editingLabels ? 'Pronto' : 'Editar'}</button>
                )}
              </div>
              <div className={s.chipsRow}>
                {boardLabels.map(l => {
                  const active = card.labels?.some(x => x.id === l.id)
                  return (
                    <span key={l.id} className={s.labelWrap}>
                      <button
                        type="button"
                        className={`${s.labelToggle} ${active ? s.labelOn : ''}`}
                        style={{ '--lc': l.color }}
                        aria-pressed={editingLabels ? undefined : active}
                        onClick={() => editingLabels ? setLabelForm({ id: l.id, name: l.name, color: l.color }) : toggleLabel(l)}
                        title={editingLabels ? 'Renomear ou trocar a cor' : active ? 'Neste cartão: clique para tirar' : 'Clique para pôr neste cartão'}
                      >
                        {editingLabels ? <LineIcon name="edit" /> : active ? <LineIcon name="check" /> : <span className={s.labelDot} />}{l.name}
                      </button>
                      {editingLabels && <button type="button" className={s.chipRemove} aria-label={`Apagar a etiqueta ${l.name} do quadro`} onClick={() => deleteLabel(l)}><LineIcon name="trash" /></button>}
                    </span>
                  )
                })}
                {boardLabels.length === 0 && !labelForm && <span className={s.emptyHint}>O quadro ainda não tem etiquetas.</span>}
                {!labelForm && (
                  <button type="button" className={s.addChip} onClick={() => { setLabelError(''); setLabelForm({ name: '', color: LABEL_COLORS[boardLabels.length % LABEL_COLORS.length] }) }}><LineIcon name="plus" /> Nova etiqueta</button>
                )}
              </div>
              {labelForm && (
                <div className={s.labelForm}>
                  <input
                    value={labelForm.name} maxLength={30} autoFocus placeholder="Nome da etiqueta (ex: Urgente)" aria-label="Nome da etiqueta"
                    onChange={e => setLabelForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveLabelForm(); if (e.key === 'Escape') setLabelForm(null) }}
                  />
                  <div className={s.colorRow}>
                    {LABEL_COLORS.map(col => (
                      <button key={col} type="button" aria-label={`Cor ${col}`} aria-pressed={labelForm.color === col}
                        className={`${s.colorSwatch} ${labelForm.color === col ? s.colorSwatchActive : ''}`}
                        style={{ background: col }} onClick={() => setLabelForm(f => ({ ...f, color: col }))} />
                    ))}
                  </div>
                  {labelError && <span role="alert" className={s.labelError}>{labelError}</span>}
                  <div className={s.labelFormActions}>
                    <button className="btn btn-primary btn-sm" disabled={!labelForm.name.trim()} onClick={saveLabelForm}>{labelForm.id ? 'Salvar etiqueta' : 'Criar etiqueta'}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setLabelForm(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>

            <div className={s.prop}>
              <div className={s.propHead}>
                <span className={s.propLabel}>Tempo</span>
                <span className={s.timeTotal}>{formatDuration(grandTotal)}</span>
              </div>
              {runningHere ? (
                <div className={s.timerRunning} role="status">
                  <span className={s.runningDot} />
                  <span className={s.timerClock}>{formatDuration(liveElapsed)}</span>
                  <button className="btn btn-danger btn-sm" onClick={stopTimer}><LineIcon name="pause" /> Parar</button>
                </div>
              ) : (
                <>
                  <button className={`btn btn-ghost btn-sm ${s.timerStart}`} onClick={startTimer} disabled={starting}>
                    <LineIcon name="play" /> {starting ? 'Iniciando...' : 'Iniciar cronômetro'}
                  </button>
                  {running && !runningHere && <span className={s.emptyHint}>O cronômetro está rodando em "{running.card_title}".</span>}
                </>
              )}
              <div className={s.manualForm}>
                <input className={s.durationInput} placeholder="HH:MM" aria-label="Tempo gasto (HH:MM)" value={manualTime.duration} onChange={e => setManualTime(f => ({ ...f, duration: e.target.value }))} />
                <input type="date" aria-label="Data do lançamento" value={manualTime.date} onChange={e => setManualTime(f => ({ ...f, date: e.target.value }))} />
                <input className={s.noteInput} placeholder="Nota (opcional)" aria-label="Nota do lançamento" value={manualTime.note} onChange={e => setManualTime(f => ({ ...f, note: e.target.value }))} />
                <button className={`btn btn-ghost btn-sm ${s.noteInput}`} onClick={submitManualTime} disabled={!manualTime.duration.trim()}>Lançar tempo</button>
              </div>
              {(card.time_entries || []).length > 0 && (
                <div className={s.timeList}>
                  {card.time_entries.map(e => (
                    <div key={e.id} className={s.timeRow}>
                      <ChipAvatar id={e.user_id} name={e.user_name} photo={e.avatar} style={{ width: 20, height: 20, fontSize: 10 }} />
                      <span className={s.timeUser}>{e.user_name?.split(' ')[0]}</span>
                      <span className={s.timeDuration}>{formatDuration(e.duration_seconds)}</span>
                      {e.note && <span className={s.timeNote} title={e.note}>{e.note}</span>}
                      {e.user_id === currentUser?.id && (
                        <button type="button" className={s.itemDelete} aria-label="Apagar lançamento" onClick={() => deleteTimeEntry(e)}><LineIcon name="close" /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={s.dangerZone}>
              {confirmDelete ? (
                <>
                  <span className={s.emptyHint}>Excluir de vez? Não dá para desfazer.</span>
                  <div className={s.dangerActions}>
                    <button className="btn btn-danger btn-sm" onClick={deleteCard}>Excluir cartão</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <button type="button" className={s.deleteBtn} onClick={() => setConfirmDelete(true)}><LineIcon name="trash" /> Excluir cartão</button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  )
}
