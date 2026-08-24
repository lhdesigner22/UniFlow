import { useState } from 'react'
import CardItem from './CardItem'
import s from './Column.module.css'

export default function Column({ column, cards, onOpenCard, onAddCard, cardIdWrap }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const submit = () => {
    if (title.trim()) onAddCard(title.trim())
    setTitle('')
    setAdding(false)
  }

  return (
    <div className={s.column}>
      <div className={s.header}>
        <span className={s.name}>{column.name}</span>
        <span className={s.count}>{cards.length}</span>
      </div>

      <div className={s.list}>
        {cards.map(card => (
          <CardItem
            key={card.id}
            id={cardIdWrap(card.id)}
            card={card}
            onOpen={() => onOpenCard(card.id)}
          />
        ))}
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
