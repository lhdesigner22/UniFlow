import { useState } from 'react'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import Column from './Column'
import api from '../../services/api'
import s from './Board.module.css'

export default function Board({ phases, cards, fields, members, labels, pipeId, currentUser, allowedAssignees, onSelectCard, onCreateCard, onUpdatePhases }) {
  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')

  const handleAddPhase = async () => {
    if (!newPhaseName.trim()) return
    const { data } = await api.post(`/pipes/${pipeId}/phases`, { name: newPhaseName })
    onUpdatePhases(prev => [...prev, data])
    setNewPhaseName('')
    setAddingPhase(false)
  }

  const handleDeletePhase = async (phaseId) => {
    await api.delete(`/pipes/${pipeId}/phases/${phaseId}`)
    onUpdatePhases(prev => prev.filter(p => p.id !== phaseId))
  }

  const handleRenamePhase = async (phaseId, name) => {
    await api.put(`/pipes/${pipeId}/phases/${phaseId}`, { name })
    onUpdatePhases(prev => prev.map(p => p.id === phaseId ? { ...p, name } : p))
  }

  return (
    <div className={s.board}>
      <SortableContext items={phases.map(p => p.id)} strategy={horizontalListSortingStrategy}>
        {phases.map(phase => (
          <Column
            key={phase.id}
            phase={phase}
            cards={cards.filter(c => c.phase_id === phase.id).sort((a, b) => a.order_index - b.order_index)}
            fields={fields}
            members={members}
            labels={labels}
            pipeId={pipeId}
            currentUser={currentUser}
            allowedAssignees={allowedAssignees}
            onSelectCard={onSelectCard}
            onCreateCard={onCreateCard}
            onDeletePhase={handleDeletePhase}
            onRenamePhase={handleRenamePhase}
          />
        ))}
      </SortableContext>

      <div className={s.addColumn}>
        {addingPhase ? (
          <div className={s.addPhaseForm}>
            <input autoFocus placeholder="Nome da fase..." value={newPhaseName}
              onChange={e => setNewPhaseName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') setAddingPhase(false) }} />
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn btn-primary btn-sm" onClick={handleAddPhase}>Adicionar</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAddingPhase(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className={s.addPhaseBtn} onClick={() => setAddingPhase(true)}>+ Adicionar fase</button>
        )}
      </div>
    </div>
  )
}
