import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext, useDroppable, useSensor, useSensors, PointerSensor,
  closestCorners, closestCenter, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import AvatarStack from '../components/common/AvatarStack'
import MemberPicker from '../components/common/MemberPicker'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Column from '../components/board/Column'
import ColumnTrashModal from '../components/board/ColumnTrashModal'
import { CardItemPreview } from '../components/board/CardItem'
import CardModal from '../components/card/CardModal'
import { avatarColor } from '../utils/avatarColor'
import s from './BoardPage.module.css'

const COL = id => `column:${id}`
const CARD = id => `card:${id}`
const COLDRAG = id => `col:${id}`
const unwrap = id => (typeof id === 'string' ? id.split(':').slice(1).join(':') : id)

// Enquanto arrasta uma COLUNA, só considera outras colunas (prefixo "col:")
// na detecção de colisão; enquanto arrasta um CARTÃO, ignora as colunas e
// considera só cartões/áreas de coluna (prefixo "card:"/"column:"). Sem
// isso, os dois tipos de arraste (aninhados um dentro do outro) disputam a
// mesma colisão e o reordenar de coluna às vezes não "pega". Coluna usa
// closestCenter (mesmo algoritmo já usado em InternetLinksPage.jsx pra
// reordenar uma fileira simples) — closestCorners é pensado pra grade 2D
// (entrar numa coluna vinda de cima/baixo) e, numa fileira só, às vezes
// resolvia "mais perto" como a própria coluna de origem, fazendo o drop
// não mover nada (a caixa só voltava pro lugar).
function collisionDetectionStrategy(args) {
  const isColumnDrag = String(args.active.id).startsWith('col:')
  const filtered = args.droppableContainers.filter(c =>
    isColumnDrag ? String(c.id).startsWith('col:') : !String(c.id).startsWith('col:')
  )
  const detector = isColumnDrag ? closestCenter : closestCorners
  return detector({ ...args, droppableContainers: filtered })
}

export default function BoardPage() {
  const { boardId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [board, setBoard] = useState(null)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState(null) // dnd-kit drag preview
  const [activeColumn, setActiveColumn] = useState(null) // dnd-kit drag preview (coluna)
  const [openCardId, setOpenCardId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [newColName, setNewColName] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [trashCount, setTrashCount] = useState(0)

  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const editingNameRef = useRef(editingName)
  editingNameRef.current = editingName

  // `silent` = recarga em segundo plano (tempo real): sem tela de "carregando"
  // e sem mexer no nome do quadro se a pessoa estiver editando ele agora.
  const load = useCallback(({ silent } = {}) => {
    if (!silent) setLoading(true)
    Promise.all([
      api.get(`/boards/${boardId}`),
      api.get(`/boards/${boardId}/cards`),
    ]).then(([b, c]) => {
      setBoard(b.data)
      if (!editingNameRef.current) setNameDraft(b.data.name)
      setCards(c.data || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [boardId])

  // Quantas colunas estão na lixeira — só pro botão saber se mostra o
  // numerozinho; a lista em si é buscada de novo quando o modal abre.
  const loadTrashCount = useCallback(() => {
    api.get(`/boards/${boardId}/columns/trash`)
      .then(r => setTrashCount((r.data || []).length))
      .catch(() => {})
  }, [boardId])
  useEffect(() => { loadTrashCount() }, [loadTrashCount])

  useEffect(() => { load() }, [load])

  // Tempo real: outro aparelho mexeu neste quadro (cartão, coluna, membro,
  // tempo...) → recarrega em silêncio. Se a pessoa estiver ARRASTANDO algo,
  // espera ela soltar (senão o cartão "pularia" debaixo do mouse) e só então
  // atualiza — com uma folga, pra o movimento dela já ter sido gravado antes.
  const draggingRef = useRef(false)
  draggingRef.current = !!(activeCard || activeColumn)
  const pendingLiveRef = useRef(false)
  useLiveRefresh(['boards', 'cards', 'time'], msg => {
    if (msg?.r === 'boards' && msg.b && msg.b !== boardId) return // era outro quadro
    if (draggingRef.current) { pendingLiveRef.current = true; return }
    load({ silent: true })
    loadTrashCount()
  })
  useEffect(() => {
    if (activeCard || activeColumn || !pendingLiveRef.current) return
    const t = setTimeout(() => {
      if (!pendingLiveRef.current) return
      pendingLiveRef.current = false
      load({ silent: true })
    }, 1200)
    return () => clearTimeout(t)
  }, [activeCard, activeColumn])

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
    const rawId = String(e.active.id)
    if (rawId.startsWith('col:')) {
      setActiveColumn(columns.find(c => c.id === unwrap(rawId)) || null)
      return
    }
    const id = unwrap(rawId)
    setActiveCard(cards.find(c => c.id === id) || null)
  }

  const handleDragOver = e => {
    const { active, over } = e
    if (!over || String(active.id).startsWith('col:')) return
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

    if (String(active.id).startsWith('col:')) {
      setActiveColumn(null)
      if (!over || active.id === over.id) return
      const oldIndex = columns.findIndex(c => COLDRAG(c.id) === active.id)
      const newIndex = columns.findIndex(c => COLDRAG(c.id) === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({ ...c, order_index: i }))
      setBoard(prev => ({ ...prev, columns: reordered }))
      try {
        await api.put(`/boards/${boardId}/columns/reorder`, { columns: reordered.map(c => ({ id: c.id, order_index: c.order_index })) })
      } catch {
        load() // rollback via refetch
      }
      return
    }

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

  const renameColumn = async (columnId, name) => {
    const prevBoard = board
    setBoard(prev => ({ ...prev, columns: prev.columns.map(c => c.id === columnId ? { ...c, name } : c) }))
    try {
      await api.put(`/boards/${boardId}/columns/${columnId}`, { name })
    } catch (e) {
      setBoard(prevBoard)
      await alertDialog(e.response?.data?.error || 'Erro ao renomear a coluna.', { title: 'Erro', danger: true })
    }
  }

  const deleteColumn = async columnId => {
    const prevBoard = board
    const prevCards = cards
    setBoard(prev => ({ ...prev, columns: prev.columns.filter(c => c.id !== columnId) }))
    setCards(prev => prev.filter(c => c.column_id !== columnId))
    try {
      await api.delete(`/boards/${boardId}/columns/${columnId}`)
      setTrashCount(n => n + 1)
    } catch (e) {
      setBoard(prevBoard)
      setCards(prevCards)
      await alertDialog(e.response?.data?.error || 'Erro ao excluir a coluna.', { title: 'Erro', danger: true })
    }
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

  // Toggle rápido do status direto no card do quadro (sem abrir o modal) —
  // cicla não iniciado → em andamento → concluído → não iniciado.
  const toggleCardProgress = async (card, nextProgress) => {
    const prevProgress = card.progress
    patchCardLocal(card.id, { progress: nextProgress })
    try {
      await api.put(`/boards/${boardId}/cards/${card.id}`, { progress: nextProgress })
    } catch {
      patchCardLocal(card.id, { progress: prevProgress })
    }
  }

  const removeCardLocal = (cardId) => {
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  const archiveBoard = async () => {
    const ok = await confirmDialog(
      `Arquivar o quadro "${board.name}"? Ele sai da lista principal, mas nada é apagado dá pra restaurar depois em "Quadros arquivados".`,
      { title: 'Arquivar quadro' }
    )
    if (!ok) return
    try {
      await api.post(`/boards/${boardId}/archive`)
      navigate('/')
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao arquivar o quadro.', { title: 'Erro', danger: true })
    }
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
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTrash(true)} title="Colunas excluídas">
            🗑️ Lixeira{trashCount > 0 ? ` (${trashCount})` : ''}
          </button>
          {(board.my_role === 'owner' || board.my_role === 'admin' || board.my_role === 'dept_admin' || user?.system_role === 'super_admin') && (
            <button className="btn btn-ghost btn-sm" onClick={archiveBoard} title="Arquivar quadro">
              📦 Arquivar
            </button>
          )}
          {board.my_role === 'owner' && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={deleteBoard} title="Excluir quadro">
              🗑️ Excluir
            </button>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className={s.board}>
          <SortableContext items={columns.map(c => COLDRAG(c.id))} strategy={horizontalListSortingStrategy}>
            {columns.map(col => (
              <ColumnSortable key={col.id} column={col}>
                {dragHandleProps => (
                  <ColumnDroppable column={col}>
                    <SortableContext items={(cardsByColumn[col.id] || []).map(c => CARD(c.id))} strategy={verticalListSortingStrategy}>
                      <Column
                        column={col}
                        cards={cardsByColumn[col.id] || []}
                        onOpenCard={id => setOpenCardId(id)}
                        onAddCard={title => addCard(col.id, title)}
                        onToggleProgress={toggleCardProgress}
                        cardIdWrap={CARD}
                        onRename={name => renameColumn(col.id, name)}
                        onDelete={() => deleteColumn(col.id)}
                        dragHandleProps={dragHandleProps}
                      />
                    </SortableContext>
                  </ColumnDroppable>
                )}
              </ColumnSortable>
            ))}
          </SortableContext>

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
          {activeColumn ? <ColumnPreview column={activeColumn} count={(cardsByColumn[activeColumn.id] || []).length} /> : null}
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
          onBoardLabelsChange={(labels, { reload } = {}) => {
            setBoard(prev => ({ ...prev, labels }))
            if (reload) load({ silent: true }) // etiqueta apagada sai dos outros cartões também
          }}
        />
      )}

      {showTrash && (
        <ColumnTrashModal
          boardId={boardId}
          onClose={() => { setShowTrash(false); loadTrashCount() }}
          onChanged={load}
        />
      )}
    </div>
  )
}

function ColumnDroppable({ column, children }) {
  const { setNodeRef } = useDroppable({ id: COL(column.id) })
  return <div ref={setNodeRef} className="board-column-drop">{children}</div>
}

// Envolve cada coluna pra ela ser arrastável (reordenar) — só o "grip" no
// cabeçalho (Column.jsx) ativa o arraste (`dragHandleProps`), o resto da
// coluna continua clicável normalmente (cartões, botões etc.).
function ColumnSortable({ column, children }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: COLDRAG(column.id) })
  const style = {
    transform: CSS.Transform.toString(transform), transition,
    opacity: isDragging ? 0.4 : 1, flexShrink: 0,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  )
}

function ColumnPreview({ column, count }) {
  return (
    <div className={s.columnPreview}>
      <span>{column.name}</span>
      <span className={s.columnPreviewCount}>{count}</span>
    </div>
  )
}
