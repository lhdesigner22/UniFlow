import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import s from './CardItem.module.css'

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
const PRIORITY_LABELS = { high: '🔴 Alta', medium: '🟡 Média', low: '🟢 Baixa' }

export default function CardItem({ card, fields, labels, onClick, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSorting } = useSortable({ id: card.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isSorting ? 0.4 : 1 }

  const cardLabels = (() => {
    try { return JSON.parse(card.labels || '[]') } catch { return [] }
  })()

  const isOverdue = card.due_date && new Date(card.due_date) < new Date()

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`${s.card} ${isDragging ? s.dragging : ''}`} onClick={onClick}>
      {cardLabels.length > 0 && (
        <div className={s.labels}>
          {cardLabels.map(labelId => {
            const label = labels.find(l => l.id === labelId)
            return label ? <span key={labelId} className={s.label} style={{ background: label.color + '30', color: label.color }}>{label.name}</span> : null
          })}
        </div>
      )}

      <div className={s.title}>{card.title}</div>

      {card.assignee_name && (
        <div className={s.assigneeRow}>
          <span className={s.assigneeBadge}>
            <span style={{ opacity:0.6, fontSize:10 }}>→</span> {card.assignee_name}
          </span>
        </div>
      )}

      <div className={s.footer}>
        <div className={s.footerLeft}>
          {card.due_date && (
            <span className={s.dueDate} style={{ color: isOverdue ? 'var(--red)' : 'var(--muted)' }}>
              📅 {new Date(card.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>
        <div className={s.footerRight}>
          <span className={s.priority} style={{ color: PRIORITY_COLORS[card.priority] }}>●</span>
          {card.created_by_name && card.created_by_name !== card.assignee_name && (
            <span style={{ fontSize:10, color:'var(--muted)' }} title={`Criado por ${card.created_by_name}`}>
              {card.created_by_name.charAt(0)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
