import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AvatarStack from '../common/AvatarStack'
import { formatDuration } from '../../utils/formatDuration'
import s from './CardItem.module.css'

function dueMeta(due) {
  if (!due) return null
  const now = new Date()
  const d = new Date(due)
  const diffDays = (d.setHours(0, 0, 0, 0) - new Date(now.setHours(0, 0, 0, 0))) / 86400000
  const label = new Date(due).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  if (diffDays < 0) return { label, tone: 'danger' }
  if (diffDays <= 2) return { label, tone: 'warning' }
  return { label, tone: 'muted' }
}

function CardBody({ card }) {
  const due = dueMeta(card.due_date)
  const checklist = card.checklist || []
  const checklistDone = checklist.filter(i => i.done).length
  const members = card.members || []
  const labels = card.labels || []
  const totalSeconds = card.total_seconds

  return (
    <>
      {labels.length > 0 && (
        <div className={s.labels}>
          {labels.map(l => <span key={l.id} className={s.labelChip} style={{ background: l.color }} title={l.name} />)}
        </div>
      )}

      <div className={s.title}>{card.title}</div>

      <div className={s.metaRow}>
        {due && <span className={`${s.badge} ${s[due.tone]}`}>📅 {due.label}</span>}
        {checklist.length > 0 && (
          <span className={s.badge}>☑ {checklistDone}/{checklist.length}</span>
        )}
        {typeof totalSeconds === 'number' && totalSeconds > 0 && (
          <span className={s.badge}>⏱ {formatDuration(totalSeconds)}</span>
        )}
      </div>

      {members.length > 0 && (
        <div className={s.membersRow}>
          <AvatarStack members={members} max={4} size={22} />
        </div>
      )}
    </>
  )
}

/** Used inside a Column, registered as a dnd-kit sortable item. */
export default function CardItem({ card, id, onOpen }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, data: { type: 'card' } })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={s.card} onClick={onOpen}>
      <CardBody card={card} />
    </div>
  )
}

/** Static visual used inside DragOverlay — no sortable/drag hooks, just the look. */
export function CardItemPreview({ card }) {
  return (
    <div className={`${s.card} ${s.overlay}`}>
      <CardBody card={card} />
    </div>
  )
}
