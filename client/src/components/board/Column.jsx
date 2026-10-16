import { useState, useEffect, useRef } from 'react'
import { confirmDialog } from '../../store/dialogStore'
import CardItem from './CardItem'
import s from './Column.module.css'

// Lembra, por coluna, se os cards concluídos estão escondidos — estilo
// Planner: some da vista assim que marca como concluído, pra não ocupar
// espaço com o que já foi feito. Padrão é escondido (chave ausente = '1').
function loadHideCompleted(columnId) {
  try {
    return localStorage.getItem(`uniflow-hide-done-${columnId}`) !== '0'
  } catch {
    return true
  }
}

export default function Column({ column, cards, onOpenCard, onAddCard, onToggleProgress, cardIdWrap, onRename, onDelete, dragHandleProps }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [hideCompleted, setHideCompleted] = useState(() => loadHideCompleted(column.id))
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(column.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(`uniflow-hide-done-${column.id}`, hideCompleted ? '1' : '0') } catch {}
  }, [hideCompleted, column.id])

  useEffect(() => {
    if (!menuOpen) return
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const submit = () => {
    if (title.trim()) onAddCard(title.trim())
    setTitle('')
    setAdding(false)
  }

  const saveName = () => {
    setEditingName(false)
    if (!nameDraft.trim() || nameDraft === column.name) { setNameDraft(column.name); return }
    onRename(nameDraft.trim())
  }

  const handleDelete = async () => {
    setMenuOpen(false)
    const ok = await confirmDialog(
      `Excluir a coluna "${column.name}"? ${cards.length > 0 ? `Os ${cards.length} cartão(ões) dela também serão apagados. ` : ''}Isso não pode ser desfeito.`,
      { title: 'Excluir coluna' }
    )
    if (!ok) return
    onDelete()
  }

  const activeCards = cards.filter(c => c.progress !== 'completed')
  const completedCards = cards.filter(c => c.progress === 'completed')

  const renderCard = card => (
    <CardItem
      key={card.id}
      id={cardIdWrap(card.id)}
      card={card}
      onOpen={() => onOpenCard(card.id)}
      onToggleProgress={next => onToggleProgress(card, next)}
    />
  )

  return (
    <div className={s.column}>
      <div className={s.header}>
        <button type="button" className={s.dragHandle} title="Arrastar para reordenar" {...dragHandleProps}>⠿</button>
        {editingName ? (
          <input
            autoFocus
            className={s.nameInput}
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(column.name); setEditingName(false) } }}
          />
        ) : (
          <span className={s.name} onClick={() => { setNameDraft(column.name); setEditingName(true) }} title="Clique para renomear">{column.name}</span>
        )}
        <span className={s.count}>{cards.length}</span>
        <div className={s.menuWrap} ref={menuRef}>
          <button type="button" className={s.menuBtn} onClick={() => setMenuOpen(v => !v)} title="Mais opções">⋮</button>
          {menuOpen && (
            <div className={s.menu}>
              <button type="button" className={s.menuItem} onClick={handleDelete}>🗑️ Excluir coluna</button>
            </div>
          )}
        </div>
      </div>

      <div className={s.list}>
        {activeCards.map(renderCard)}

        {completedCards.length > 0 && (
          <>
            <button
              type="button"
              className={s.completedToggle}
              onClick={() => setHideCompleted(v => !v)}
              title={hideCompleted ? 'Mostrar concluídos' : 'Esconder concluídos'}
            >
              <span className={s.completedChevron} data-open={!hideCompleted}>›</span>
              ✓ {completedCards.length} concluído{completedCards.length > 1 ? 's' : ''}
            </button>
            {!hideCompleted && completedCards.map(renderCard)}
          </>
        )}
      </div>

      <div className={s.footer}>
        {adding ? (
          <input
            autoFocus
            className={s.quickAdd}
            placeholder="Título do cartão..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={submit}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setTitle(''); setAdding(false) } }}
          />
        ) : (
          <button className={s.addBtn} onClick={() => setAdding(true)}>+ Adicionar cartão</button>
        )}
      </div>
    </div>
  )
}
