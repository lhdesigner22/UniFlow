import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext, useDroppable, useSensor, useSensors, PointerSensor,
  closestCorners, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import AvatarStack from '../components/common/AvatarStack'
import MemberPicker from '../components/common/MemberPicker'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Column from '../components/board/Column'
import { CardItemPreview } from '../components/board/CardItem'
import CardModal from '../components/card/CardModal'
import { avatarColor } from '../utils/avatarColor'
import s from './BoardPage.module.css'

const COL = id => `column:${id}`
const CARD = id => `card:${id}`
const unwrap = id => (typeof id === 'string' ? id.split(':').slice(1).join(':') : id)

export default function BoardPage() {
  const { boardId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [board, setBoard] = useState(null)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState(null) // dnd-kit drag preview
  const [openCardId, setOpenCardId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [newColName, setNewColName] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)

  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get(`/boards/${boardId}`),
      api.get(`/boards/${boardId}/cards`),
    ]).then(([b, c]) => {
      setBoard(b.data)
      setNameDraft(b.data.name)
      setCards(c.data || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [boardId])

  useEffect(() => { load() }, [load])

  const columns = useMemo(
    () => (board?.columns || []).slice().sort((a, b) => a.order_index - b.order_index),
    [board]
  )

  const cardsByColumn = useMemo(() => {
    const map = {}
    for (const col of columns) map[col.id] = []
    for (const c of cards) {
      if (!map[c.column_id]) map[c.column_id] = []
      map[c.column_id].push(c)
    }
    for (const id in map) map[id].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    return map
  }, [cards, columns])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const findColumnOfCard = cardId => cards.find(c => c.id === cardId)?.column_id

  const handleDragStart = e => {
    const id = unwrap(e.active.id)
    setActiveCard(cards.find(c => c.id === id) || null)
  }

  const handleDragOver = e => {
    const { active, over } = e
    if (!over) return
    const activeId = unwrap(active.id)
    const overRaw = over.id
    const overIsColumn = overRaw.startsWith('column:')
    const overId = unwrap(overRaw)
    const fromCol = findColumnOfCard(activeId)
    const toCol = overIsColumn ? overId : findColumnOfCard(overId)
    if (!toCol || fromCol === toCol) return

    setCards(prev => {
      const moved = prev.find(c => c.id === activeId)
      if (!moved) return prev
      const rest = prev.filter(c => c.id !== activeId)
      const destItems = rest.filter(c => c.column_id === toCol)
      let insertAt = destItems.length
      if (!overIsColumn) {
        const idx = destItems.findIndex(c => c.id === overId)
        if (idx !== -1) insertAt = idx
      }
      const updatedMoved = { ...moved, column_id: toCol }
      const newDest = [...destItems.slice(0, insertAt), updatedMoved, ...destItems.slice(insertAt)]
      const others = rest.filter(c => c.column_id !== toCol)
      return [...others, ...newDest]
    })
  }

  const handleDragEnd = async e => {
    const { active, over } = e
    setActiveCard(null)
    if (!over) return
    const activeId = unwrap(active.id)
    const overRaw = over.id
    const overIsColumn = overRaw.startsWith('column:')
    const overId = unwrap(overRaw)

    const before = cardsRef.current
    let finalCards = before
    const col = findColumnOfCard(activeId)

    if (!overIsColumn && overId !== activeId) {
      const sameColItems = before.filter(c => c.column_id === col)
      const oldIndex = sameColItems.findIndex(c => c.id === activeId)
      const newIndex = sameColItems.findIndex(c => c.id === overId)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(sameColItems, oldIndex, newIndex)
        const others = before.filter(c => c.column_id !== col)
        finalCards = [...others, ...reordered]
        setCards(finalCards)
      }
    }

    // Recompute order_index (0..n-1) for the affected column and persist.
    const finalColItems = finalCards.filter(c => c.column_id === col)
    const orderIndex = finalColItems.findIndex(c => c.id === activeId)
    const withOrder = finalCards.map(c => {
      if (c.column_id !== col) return c
      const idx = finalColItems.findIndex(x => x.id === c.id)
      return { ...c, order_index: idx }
    })
    setCards(withOrder)

    try {
      await api.post(`/boards/${boardId}/cards/${activeId}/move`, { column_id: col, order_index: orderIndex })
    } catch {
      load() // rollback via refetch
    }
  }

  const saveBoardName = async () => {
    setEditingName(false)
    if (!nameDraft.trim() || nameDraft === board.name) { setNameDraft(board.name); return }
    try {
      const { data } = await api.put(`/boards/${boardId}`, { name: nameDraft })
      setBoard(prev => ({ ...prev, ...data }))
    } catch { setNameDraft(board.name) }
  }

  const inviteMember = async (u) => {
    try {
      await api.post(`/boards/${boardId}/members`, { user_id: u.id })
      setBoard(prev => ({ ...prev, members: [...(prev.members || []), { ...u, role: 'member' }] }))
    } catch {}
  }

  const addColumn = async () => {
    if (!newColName.trim()) { setAddingColumn(false); return }
    try {
      const { data } = await api.post(`/boards/${boardId}/columns`, { name: newColName.trim(), order_index: columns.length })
      setBoard(prev => ({ ...prev, columns: [...(prev.columns || []), data] }))
      setNewColName('')
      setAddingColumn(false)
    } catch { setAddingColumn(false) }
  }

  const addCard = async (columnId, title) => {
    try {
      const { data } = await api.post(`/boards/${boardId}/cards`, { title, column_id: columnId })
      setCards(prev => [...prev, data])
    } catch {}
  }

  const patchCardLocal = (cardId, patch) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...patch } : c))
  }

  const removeCardLocal = (cardId) => {
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  const deleteBoard = async () => {
    const ok = await confirmDialog(
      `Excluir o quadro "${board.name}"? Todas as colunas, cartões e lançamentos de tempo dele serão apagados. Isso não pode ser desfeito.`,
      { title: 'Excluir quadro' }
    )
    if (!ok) return
    try {
      await api.delete(`/boards/${boardId}`)
      navigate('/')
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir o quadro.', { title: 'Erro', danger: true })
    }
  }

  if (loading) return <div className={s.loading}>Carregando quadro...</div>
  if (!board) return <div className={s.loading}>Quadro não encontrado.</div>

  return (
    <div className={s.page}>
      <div className={s.accentBar} style={{ background: board.color || avatarColor(board.id) }} />

      <div className={s.header}>
        {editingName ? (
          <input
            autoFocus
            className={s.nameInput}
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveBoardName}
            onKeyDown={e => { if (e.key === 'Enter') saveBoardName(); if (e.key === 'Escape') { setNameDraft(board.name); setEditingName(false) } }}
          />
        ) : (
          <h1 className={s.boardName} onClick={() => setEditingName(true)} title="Clique para renomear">{board.name}</h1>
        )}

        <div className={s.headerRight}>
          <AvatarStack members={board.members || []} max={6} size={30} />
          <div className={s.inviteWrap}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(v => !v)}>+ Convidar</button>
            {showInvite && (
              <MemberPicker
                align="right"
                existingIds={(board.members || []).map(m => m.id)}
                onPick={u => { inviteMember(u); setShowInvite(false) }}
                onClose={() => setShowInvite(false)}
              />
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/tempo')}>Tempo da equipe</button>
          {board.my_role === 'owner' && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={deleteBoard} title="Excluir quadro">
              🗑️ Excluir
            </button>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className={s.board}>
          {columns.map(col => (
            <ColumnDroppable key={col.id} column={col}>
              <SortableContext items={(cardsByColumn[col.id] || []).map(c => CARD(c.id))} strategy={verticalListSortingStrategy}>
                <Column
                  column={col}
                  cards={cardsByColumn[col.id] || []}
                  onOpenCard={id => setOpenCardId(id)}
                  onAddCard={title => addCard(col.id, title)}
                  cardIdWrap={CARD}
                />
              </SortableContext>
            </ColumnDroppable>
          ))}

          <div className={s.newColumn}>
            {addingColumn ? (
              <input
                autoFocus
                placeholder="Nome da coluna"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                onBlur={addColumn}
                onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') setAddingColumn(false) }}
              />
            ) : (
              <button className={s.newColumnBtn} onClick={() => setAddingColumn(true)}>+ Adicionar coluna</button>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeCard ? <CardItemPreview card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>

      {openCardId && (
        <CardModal
          boardId={boardId}
          cardId={openCardId}
          board={board}
          currentUser={user}
          onClose={() => setOpenCardId(null)}
          onPatchLocal={patchCardLocal}
          onDeleted={() => { removeCardLocal(openCardId); setOpenCardId(null) }}
        />
      )}
    </div>
  )
}

function ColumnDroppable({ column, children }) {
  const { setNodeRef } = useDroppable({ id: COL(column.id) })
  return <div ref={setNodeRef} className="board-column-drop">{children}</div>
}
