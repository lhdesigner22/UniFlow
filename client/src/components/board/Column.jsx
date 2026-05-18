import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import CardItem from './CardItem'
import api from '../../services/api'
import s from './Column.module.css'

export default function Column({ phase, cards, fields, members, labels, pipeId, currentUser, allowedAssignees, onSelectCard, onCreateCard, onDeletePhase, onRenamePhase }) {
  const [addingCard, setAddingCard] = useState(false)
  const [cardTitle, setCardTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [editing, setEditing] = useState(false)
  const [phaseName, setPhaseName] = useState(phase.name)
  const [showMenu, setShowMenu] = useState(false)

  const { setNodeRef, isOver } = useDroppable({ id: phase.id })

  const handleAddCard = async () => {
    if (!cardTitle.trim()) return
    const { data } = await api.post(`/pipes/${pipeId}/cards`, {
      title: cardTitle,
      phase_id: phase.id,
      assignee_id: assigneeId || null
    })
    onCreateCard(data)
    setCardTitle('')
    setAssigneeId('')
    setAddingCard(false)
  }

  const handleRename = async () => {
    if (phaseName.trim() && phaseName !== phase.name) await onRenamePhase(phase.id, phaseName)
    setEditing(false)
  }

  const doneCount = cards.filter(c => c.phase_id === phase.id).length

  return (
    <div className={`${s.column} ${isOver ? s.over : ''}`}>
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span className={s.dot} style={{ background: phase.color }} />
          {editing ? (
            <input className={s.renameInput} value={phaseName} onChange={e => setPhaseName(e.target.value)}
              onBlur={handleRename} onKeyDown={e => { if (e.key === 'Enter') handleRename() }} autoFocus />
          ) : (
            <span className={s.phaseName} onDoubleClick={() => setEditing(true)}>{phase.name}</span>
          )}
          <span className={s.count}>{cards.length}</span>
        </div>
        <div className={s.headerActions}>
          <button className="btn btn-icon" onClick={() => setAddingCard(true)} title="Adicionar card">+</button>
          <div style={{ position:'relative' }}>
            <button className="btn btn-icon" onClick={() => setShowMenu(!showMenu)}>⋯</button>
            {showMenu && (
              <div className={s.menu}>
                <button onClick={() => { setEditing(true); setShowMenu(false) }}>✏️ Renomear</button>
                <button onClick={() => { if (confirm('Excluir esta fase?')) onDeletePhase(phase.id); setShowMenu(false) }} style={{ color:'var(--red)' }}>🗑️ Excluir fase</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={setNodeRef} className={s.cards}>
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <CardItem key={card.id} card={card} fields={fields} labels={labels} onClick={() => onSelectCard(card.id)} />
          ))}
        </SortableContext>

        {addingCard && (
          <div className={s.addCardForm}>
            <textarea autoFocus rows={2} placeholder="Título do card..." value={cardTitle}
              onChange={e => setCardTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCard() } if (e.key === 'Escape') setAddingCard(false) }} />
            {members && members.length > 0 && (
              <>
                {allowedAssignees && (
                  <div style={{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.2)', borderRadius:6, padding:'4px 8px', display:'flex', alignItems:'center', gap:4 }}>
                    🔒 Encaminhamento restrito
                  </div>
                )}
                <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
                  style={{ fontSize:12, padding:'4px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, color:'var(--white)' }}>
                  <option value="">📤 Encaminhar para...</option>
                  {(allowedAssignees
                    ? members.filter(m => allowedAssignees.some(a => a.id === m.id))
                    : members.filter(m => m.id !== currentUser?.id)
                  ).map(m => (
                    <option key={m.id} value={m.id}>→ {m.name}</option>
                  ))}
                  {!allowedAssignees && <option value={currentUser?.id}>👤 Para mim</option>}
                </select>
              </>
            )}
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn btn-primary btn-sm" onClick={handleAddCard}>Enviar</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAddingCard(false); setAssigneeId('') }}>✕</button>
            </div>
          </div>
        )}
      </div>

      {!addingCard && (
        <button className={s.addBtn} onClick={() => setAddingCard(true)}>+ Adicionar card</button>
      )}
    </div>
  )
}
