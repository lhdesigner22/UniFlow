import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import api from '../services/api'
import { useSocket } from '../hooks/useSocket'
import { useAuthStore } from '../store/authStore'
import Board from '../components/board/Board'
import CardModal from '../components/card/CardModal'
import CardItem from '../components/board/CardItem'
import s from './BoardPage.module.css'

export default function BoardPage() {
  const { pipeId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [pipe, setPipe] = useState(null)
  const [phases, setPhases] = useState([])
  const [cards, setCards] = useState([])
  const [fields, setFields] = useState([])
  const [members, setMembers] = useState([])
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCard, setSelectedCard] = useState(null)
  const [activeCard, setActiveCard] = useState(null)
  const [filter, setFilter] = useState({ priority: '', search: '' })
  const [showArchived, setShowArchived] = useState(false)
  const [isAdmin, setIsAdmin] = useState(true)
  const [onlyMine, setOnlyMine] = useState(false)
  const [allowedAssignees, setAllowedAssignees] = useState(null) // null = sem restrição

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const load = useCallback(() => {
    api.get(`/pipes/${pipeId}`).then(r => {
      setPipe(r.data)
      setPhases(r.data.phases)
      setCards(r.data.cards)
      setFields(r.data.fields)
      setMembers(r.data.members)
      setLabels(r.data.labels)
      setIsAdmin(r.data.isAdmin !== false)
      setAllowedAssignees(r.data.allowedAssignees ?? null)
      setLoading(false)
    }).catch(err => {
      // Only navigate away if the pipe truly doesn't exist (404).
      // Network / server errors should NOT redirect — the pipe still exists.
      if (err?.response?.status === 404) navigate('/')
      else setLoading(false) // stay on page; user can refresh manually
    })
  }, [pipeId])

  useEffect(() => { load() }, [load])

  useSocket(pipeId, {
    'card-moved': ({ cardId, phaseId, orderIndex }) => {
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, phase_id: phaseId, order_index: orderIndex } : c))
    },
    'card-created': ({ card }) => {
      setCards(prev => prev.some(c => c.id === card.id) ? prev : [...prev, card])
    },
    'card-updated': ({ card }) => {
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, ...card } : c))
    },
    'card-deleted': ({ cardId }) => {
      setCards(prev => prev.filter(c => c.id !== cardId))
      setSelectedCard(sel => sel === cardId ? null : sel)
    },
    'cards-reordered': ({ cards: updated }) => {
      setCards(prev => prev.map(c => {
        const u = updated.find(u => u.id === c.id)
        return u ? { ...c, phase_id: u.phase_id, order_index: u.order_index } : c
      }))
    },
  })

  const handleDragStart = ({ active }) => {
    setActiveCard(cards.find(c => c.id === active.id) || null)
  }

  const handleDragEnd = async ({ active, over }) => {
    setActiveCard(null)
    if (!over || active.id === over.id) return

    const card = cards.find(c => c.id === active.id)
    if (!card) return

    const overCard = cards.find(c => c.id === over.id)
    const overPhaseId = overCard ? overCard.phase_id : over.id
    const phaseCards = cards.filter(c => c.phase_id === overPhaseId && c.id !== card.id).sort((a, b) => a.order_index - b.order_index)
    const overIndex = overCard ? phaseCards.findIndex(c => c.id === overCard.id) : phaseCards.length
    const newIndex = overIndex === -1 ? phaseCards.length : overIndex
    phaseCards.splice(newIndex, 0, card)
    const updates = phaseCards.map((c, i) => ({ id: c.id, phase_id: overPhaseId, order_index: i }))

    setCards(prev => {
      const rest = prev.filter(c => c.phase_id !== overPhaseId && c.id !== card.id)
      const updated = phaseCards.map((c, i) => ({ ...c, phase_id: overPhaseId, order_index: i }))
      return [...rest, ...updated]
    })

    try {
      await api.post(`/pipes/${pipeId}/cards/reorder`, { cards: updates })
    } catch { load() }
  }

  const handleCreateCard = (card) => setCards(prev => [...prev, card])
  const handleUpdateCard = (updated) => setCards(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
  const handleArchiveCard = (id) => setCards(prev => prev.filter(c => c.id !== id))
  const handleDeleteCard = async (id) => {
    await api.delete(`/pipes/${pipeId}/cards/${id}`)
    setCards(prev => prev.filter(c => c.id !== id))
    setSelectedCard(null)
  }

  const filteredCards = cards.filter(c => {
    if (filter.priority && c.priority !== filter.priority) return false
    if (filter.search && !c.title.toLowerCase().includes(filter.search.toLowerCase())) return false
    // Admin com filtro "só os meus" ativo
    if (isAdmin && onlyMine && c.assignee_id !== user?.id && c.created_by !== user?.id) return false
    return true
  })

  if (loading) return <div className={s.loading}><span className="spinner">⟳</span> Carregando...</div>
  if (!pipe) return null

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.pipeIcon} style={{ background: pipe.color + '25', color: pipe.color }}>{pipe.icon}</div>
          <div>
            <h1 className={s.pipeName}>{pipe.name}</h1>
            {pipe.description && <p className={s.pipeDesc}>{pipe.description}</p>}
          </div>
        </div>
        <div className={s.headerRight}>
          <div className={s.members}>
            {members.slice(0, 4).map((m, i) => (
              <div key={m.id} className="avatar" style={{ background: ['#4a7cf7','#22c55e','#8b5cf6','#f59e0b'][i % 4], fontSize: 11, marginLeft: i > 0 ? -8 : 0, border:'2px solid var(--navy2)', zIndex: 10 - i }}>
                {m.name.charAt(0)}
              </div>
            ))}
            {members.length > 4 && <div className="avatar" style={{ background:'var(--navy3)', fontSize:10, marginLeft:-8 }}>+{members.length - 4}</div>}
          </div>
          <Link to={`/pipe/${pipeId}/reports`} className="btn btn-ghost btn-sm">📊 Relatórios</Link>
          <Link to={`/pipe/${pipeId}/settings`} className="btn btn-ghost btn-sm">⚙️ Config</Link>
        </div>
      </div>

      <div className={s.toolbar}>
        <input className={s.search} placeholder="🔍 Buscar cards..." value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} style={{ width:220 }} />
        <select style={{ width:'auto' }} value={filter.priority} onChange={e => setFilter(f => ({ ...f, priority: e.target.value }))}>
          <option value="">Todas prioridades</option>
          <option value="high">🔴 Alta</option>
          <option value="medium">🟡 Média</option>
          <option value="low">🟢 Baixa</option>
        </select>
        <button className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowArchived(!showArchived)}>
          📦 {showArchived ? 'Ver Ativos' : 'Arquivados'}
        </button>

        {/* Admin: toggle de visibilidade */}
        {isAdmin && (
          <button
            className={`btn btn-sm ${onlyMine ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setOnlyMine(v => !v)}
            title={onlyMine ? 'Clique para ver todos os cards' : 'Clique para ver só os seus cards'}
          >
            {onlyMine ? '👤 Meus cards' : '👥 Todos os cards'}
          </button>
        )}

        {/* Membro: aviso fixo */}
        {!isAdmin && (
          <span style={{ fontSize:12, color:'#f59e0b', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.25)', borderRadius:20, padding:'3px 10px', display:'flex', alignItems:'center', gap:4 }}
            title="Você está vendo apenas os cards encaminhados para você ou criados por você">
            👁️ Visão: meus cards
          </span>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Board
          phases={phases}
          cards={filteredCards}
          fields={fields}
          members={members}
          labels={labels}
          pipeId={pipeId}
          currentUser={user}
          allowedAssignees={allowedAssignees}
          onSelectCard={setSelectedCard}
          onCreateCard={handleCreateCard}
          onUpdatePhases={setPhases}
        />
        <DragOverlay>
          {activeCard && <CardItem card={activeCard} fields={fields} labels={labels} isDragging />}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardModal
          cardId={selectedCard}
          pipeId={pipeId}
          phases={phases}
          fields={fields}
          members={members}
          labels={labels}
          allowedAssignees={allowedAssignees}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleUpdateCard}
          onArchive={handleArchiveCard}
          onDelete={handleDeleteCard}
        />
      )}
    </div>
  )
}
