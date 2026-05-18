import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import s from './CardItem.module.css'

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

export default function CardItem({ card, fields, labels, onClick, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSorting } = useSortable({ id: card.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isSorting ? 0.4 : 1 }

  const cardLabels = (() => { try { return JSON.parse(card.labels || '[]') } catch { return [] } })()
  const isOverdue  = card.due_date && new Date(card.due_date) < new Date()
  const pColor     = PRIORITY_COLOR[card.priority] || '#64748b'

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`${s.card} ${isDragging ? s.dragging : ''}`}
      onClick={onClick}
    >
      {/* Priority left bar */}
      <div className={s.priorityBar} style={{ background: pColor }} />

      <div className={s.inner}>
        {/* Labels */}
        {cardLabels.length > 0 && (
          <div className={s.labels}>
            {cardLabels.map(labelId => {
              const label = labels.find(l => l.id === labelId)
              return label ? (
                <span key={labelId} className={s.label}
                  style={{ background: label.color + '28', color: label.color, border: `1px solid ${label.color}40` }}>
                  {label.name}
                </span>
              ) : null
            })}
          </div>
        )}

        {/* Title */}
        <div className={s.title}>{card.title}</div>

        {/* Assignee */}
        {card.assignee_name && (
          <div className={s.assigneeRow}>
            <span className={s.assigneeBadge}>
              <span className={s.assigneeArrow}>→</span>
              {card.assignee_name}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={s.footer}>
        <div className={s.footerLeft}>
          {card.due_date && (
            <span className={s.dueDate} style={{ color: isOverdue ? 'var(--red)' : 'var(--muted)' }}>
              {isOverdue ? '⚠️' : '📅'}
              {new Date(card.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })}
            </span>
          )}
        </div>
        <div className={s.footerRight}>
          {card.created_by_name && card.created_by_name !== card.assignee_name && (
            <span className={s.creatorInitial} title={`Criado por ${card.created_by_name}`}>
              {card.created_by_name.charAt(0)}
            </span>
          )}
          <div className={s.priorityDot} style={{ background: pColor }} title={card.priority} />
        </div>
      </div>
    </div>
  )
}
