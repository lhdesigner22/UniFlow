import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AvatarStack from '../common/AvatarStack'
import LineIcon from '../common/LineIcon'
import { formatDuration, parseDateOnly } from '../../utils/formatDuration'
import s from './CardItem.module.css'

// Prazo em linguagem de gente: "Venceu ontem", "Hoje", "Amanhã", "15 nov"
function dueMeta(due, done) {
  if (!due) return null
  const now = new Date()
  const d = parseDateOnly(due)
  const diffDays = Math.round((d.setHours(0, 0, 0, 0) - new Date(now.setHours(0, 0, 0, 0))) / 86400000)
  const short = parseDateOnly(due).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ')
  if (done) return { label: short, tone: 'muted' }
  if (diffDays === -1) return { label: 'Venceu ontem', tone: 'danger' }
  if (diffDays < 0) return { label: `Venceu ${short}`, tone: 'danger' }
  if (diffDays === 0) return { label: 'Hoje', tone: 'warning' }
  if (diffDays === 1) return { label: 'Amanhã', tone: 'warning' }
  return { label: short, tone: 'muted' }
}

// Cor/símbolo do status estilo Planner + pra onde o clique leva em seguida
// (cicla: não iniciado → em andamento → concluído → não iniciado).
const PROGRESS_CYCLE = { not_started: 'in_progress', in_progress: 'completed', completed: 'not_started' }
const PROGRESS_META = {
  not_started: { cls: '', title: 'Não iniciado — clique para iniciar' },
  in_progress: { cls: 'progressInProgress', title: 'Em andamento — clique para concluir' },
  completed: { cls: 'progressCompleted', title: 'Concluído — clique para reabrir' },
}

function ProgressToggle({ progress, onToggle }) {
  const p = progress || 'not_started'
  const meta = PROGRESS_META[p]
  return (
    <button
      type="button"
      className={`${s.progressDot} ${meta.cls ? s[meta.cls] : ''}`}
      title={meta.title}
      aria-label={meta.title}
      onClick={e => { e.stopPropagation(); onToggle?.(PROGRESS_CYCLE[p]) }}
    >
      {p === 'completed' && <LineIcon name="check" size={11} />}
    </button>
  )
}

function CardBody({ card, onToggleProgress }) {
  const due = dueMeta(card.due_date, card.progress === 'completed')
  const checklist = card.checklist || []
  const checklistDone = checklist.filter(i => i.done).length
  const members = card.members || []
  const labels = card.labels || []
  const totalSeconds = card.total_seconds
  const done = card.progress === 'completed'

  return (
    <>
      {labels.length > 0 && (
        <div className={s.labels}>
          {labels.map(l => (
            <span key={l.id} className={s.labelChip} style={{ '--lc': l.color }} title={l.name}>{l.name}</span>
          ))}
        </div>
      )}

      <div className={s.titleRow}>
        <ProgressToggle progress={card.progress} onToggle={onToggleProgress} />
        <span className={`${s.title} ${done ? s.titleDone : ''}`}>{card.title}</span>
      </div>

      <div className={s.metaRow}>
        {due && <span className={`${s.badge} ${s[due.tone]}`}><LineIcon name="calendar" />{due.label}</span>}
        {checklist.length > 0 && (
          <span className={`${s.badge} ${checklistDone === checklist.length ? s.allDone : ''}`} title="Itens do checklist feitos">
            <LineIcon name="check" />{checklistDone}/{checklist.length}
          </span>
        )}
        {typeof totalSeconds === 'number' && totalSeconds > 0 && (
          <span className={s.badge} title="Tempo registrado"><LineIcon name="clock" />{formatDuration(totalSeconds)}</span>
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
export default function CardItem({ card, id, onOpen, onToggleProgress }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, data: { type: 'card' } })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={s.card} onClick={onOpen}>
      <CardBody card={card} onToggleProgress={onToggleProgress} />
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
