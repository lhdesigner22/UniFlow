import { useState, useEffect, useCallback, Fragment } from 'react'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import { confirmDialog } from '../store/dialogStore'
import s from './AgendaPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import { pressable } from '../utils/pressable'

const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MONTH_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const RECURRENCE_LABEL = { weekly: 'Semanal', monthly: 'Mensal' }

const EMPTY_FORM = { title: '', description: '', board_id: '', event_date: '', event_time: '', recurrence_type: 'none', recurrence_until: '', department_id: null }

// data LOCAL (não UTC: com toISOString, depois das 21h de Brasília "hoje" virava amanhã)
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d) {
  const date = new Date(d)
  const day = date.getDay() // 0 = domingo ... 6 = sábado
  const diff = day === 0 ? -6 : 1 - day // volta pra segunda-feira
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}
// Parseia YYYY-MM-DD como data local (evita o shift de fuso do `new Date(string)`)
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function formatDayHeader(dateStr) {
  const date = parseLocalDate(dateStr)
  return `${WEEKDAY_LONG[date.getDay()]}, ${date.getDate()} de ${MONTH_LONG[date.getMonth()]}`
}
function formatRangeLabel(from, to) {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  return `${a.getDate()} de ${MONTH_LONG[a.getMonth()]} – ${b.getDate()} de ${MONTH_LONG[b.getMonth()]}`
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }

export default function AgendaPage() {
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [events, setEvents] = useState([])
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState(null)
  const [dayPopup, setDayPopup] = useState(null) // string YYYY-MM-DD (dia clicado no calendário) ou null

  // Grade do calendário: começa na segunda da semana que contém o dia 1º,
  // termina no domingo da semana que contém o último dia do mês — assim as
  // semanas ficam completas, com dias do mês anterior/seguinte esmaecidos.
  const gridStart = startOfWeek(startOfMonth(monthAnchor))
  const gridEnd = addDays(startOfWeek(endOfMonth(monthAnchor)), 6)

  const from = view === 'calendar' ? isoDate(gridStart) : isoDate(weekStart)
  const to = view === 'calendar' ? isoDate(gridEnd) : isoDate(addDays(weekStart, 6))

  const goPrev = () => view === 'calendar' ? setMonthAnchor(a => addMonths(a, -1)) : setWeekStart(w => addDays(w, -7))
  const goNext = () => view === 'calendar' ? setMonthAnchor(a => addMonths(a, 1)) : setWeekStart(w => addDays(w, 7))
  const goToday = () => { setWeekStart(startOfWeek(new Date())); setMonthAnchor(new Date()) }

  const periodLabel = view === 'calendar'
    ? `${MONTH_LONG[monthAnchor.getMonth()].charAt(0).toUpperCase()}${MONTH_LONG[monthAnchor.getMonth()].slice(1)} de ${monthAnchor.getFullYear()}`
    : formatRangeLabel(from, to)

  useEffect(() => { api.get('/boards').then(r => setBoards(r.data || [])).catch(() => {}) }, [])

  // `silent` = recarga em segundo plano (tempo real): sem "carregando" e, se
  // falhar, mantém os eventos que já estão na tela.
  const loadEvents = useCallback(({ silent } = {}) => {
    if (!silent) setLoading(true)
    api.get('/events', { params: { from, to } })
      .then(r => setEvents(r.data || []))
      .catch(() => { if (!silent) setEvents([]) })
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { loadEvents() }, [loadEvents])
  useLiveRefresh(['events'], () => loadEvents({ silent: true })) // outro aparelho criou/mudou/apagou um evento

  const boardById = id => boards.find(b => b.id === id)

  // Agrupa as ocorrências (já expandidas pela API) por dia
  const byDay = {}
  for (const ev of events) {
    (byDay[ev.occurrence_date] ||= []).push(ev)
  }
  const days = Object.keys(byDay).sort()
  for (const d of days) {
    byDay[d].sort((a, b) => (a.event_time || '').localeCompare(b.event_time || ''))
  }

  const { user } = useAuthStore()
  const writable = canEditModule(user, 'agenda') // cargo que só VÊ a Agenda não cria evento

  const openCreate = (dateStr) => {
    if (!writable) return
    setEditing(null)
    setForm({ ...EMPTY_FORM, event_date: dateStr || from, department_id: defaultDepartment() })
    setFormMsg(null)
    setShowModal(true)
  }

  const openEdit = (occ) => {
    setEditing(occ)
    setForm({
      title: occ.title || '',
      description: occ.description || '',
      board_id: occ.board_id || '',
      event_date: occ.occurrence_date,
      event_time: occ.event_time || '',
      recurrence_type: occ.recurrence_type || 'none',
      recurrence_until: occ.recurrence_until ? occ.recurrence_until.slice(0, 10) : '',
      department_id: occ.department_id ?? null,
    })
    setFormMsg(null)
    setShowModal(true)
  }

  const saveEvent = async () => {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)
    setFormMsg(null)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      board_id: form.board_id || null,
      event_date: form.event_date,
      event_time: form.event_time || null,
      recurrence_type: form.recurrence_type,
      recurrence_until: form.recurrence_type !== 'none' ? (form.recurrence_until || null) : null,
      department_id: form.department_id,
    }
    try {
      if (editing) await api.put(`/events/${editing.id}`, payload)
      else await api.post('/events', payload)
      setShowModal(false)
      loadEvents()
    } catch (e) {
      setFormMsg(e.response?.data?.error || 'Erro ao salvar evento.')
    } finally {
      setSaving(false)
    }
  }

  const deleteEvent = async () => {
    if (!editing) return
    if (!(await confirmDialog('Excluir este evento? Isso remove todas as ocorrências dele.'))) return
    await api.delete(`/events/${editing.id}`)
    setShowModal(false)
    loadEvents()
  }

  const todayInView = view === 'calendar'
    ? monthAnchor.getMonth() === new Date().getMonth() && monthAnchor.getFullYear() === new Date().getFullYear()
    : isoDate(startOfWeek(new Date())) === isoDate(weekStart)

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Agenda</h1>
          <p className={s.sub}>{events.length
            ? `${events.length} ${events.length === 1 ? 'evento' : 'eventos'} ${view === 'calendar' ? 'neste mês' : 'nesta semana'}, incluindo os que vêm do GLPI.`
            : 'Eventos da equipe e reservas que chegam do GLPI.'}</p>
        </div>
        {writable && <button className="btn btn-primary" onClick={() => openCreate()}><LineIcon name="plus" size={15} /> Novo evento</button>}
      </div>

      <div className={s.periodBar}>
        <div className={s.periodNav}>
          <button type="button" className={s.navBtn} onClick={goPrev} aria-label={view === 'calendar' ? 'Mês anterior' : 'Semana anterior'} title={view === 'calendar' ? 'Mês anterior' : 'Semana anterior'}>
            <LineIcon name="chevronLeft" size={16} />
          </button>
          <button type="button" className={s.navBtn} onClick={goNext} aria-label={view === 'calendar' ? 'Próximo mês' : 'Próxima semana'} title={view === 'calendar' ? 'Próximo mês' : 'Próxima semana'}>
            <LineIcon name="chevronRight" size={16} />
          </button>
          <h2 className={s.periodLabel} aria-live="polite">{periodLabel}</h2>
          {!todayInView && <button type="button" className="btn btn-ghost btn-sm" onClick={goToday}>Voltar para hoje</button>}
        </div>

        <div className={s.viewToggle} role="group" aria-label="Como ver a agenda">
          <button type="button" aria-pressed={view === 'list'} className={`${s.viewToggleBtn} ${view === 'list' ? s.active : ''}`} onClick={() => setView('list')}>
            <LineIcon name="list" size={14} /> Semana
          </button>
          <button type="button" aria-pressed={view === 'calendar'} className={`${s.viewToggleBtn} ${view === 'calendar' ? s.active : ''}`} onClick={() => setView('calendar')}>
            <LineIcon name="calendar" size={14} /> Mês
          </button>
        </div>
      </div>

      {loading ? (
        <div className={s.skeleton} />
      ) : view === 'calendar' ? (
        <>
          <CalendarView
            gridStart={gridStart}
            gridEnd={gridEnd}
            monthAnchor={monthAnchor}
            byDay={byDay}
            onOpenEvent={openEdit}
            onDayClick={setDayPopup}
          />
          <p className={s.hint}>Clique num dia para ver todos os eventos dele; clique num evento para editar.</p>
        </>
      ) : (
        <WeekView weekStart={weekStart} byDay={byDay} boardById={boardById} onOpenEvent={openEdit} onCreate={openCreate} writable={writable} />
      )}

      {showModal && (
        <Modal title={editing ? 'Editar evento' : 'Novo evento'} onClose={() => setShowModal(false)} width={480}>
          <div className="form-group">
            <label htmlFor="agenda-titulo" className="label">Título</label>
            <input id="agenda-titulo"
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Reunião de equipe"
            />
          </div>
          <div className="form-group">
            <label htmlFor="agenda-descricao-opcional" className="label">Descrição (opcional)</label>
            <textarea id="agenda-descricao-opcional"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detalhes do evento..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="agenda-quadro" className="label">Quadro</label>
            <select id="agenda-quadro" value={form.board_id} onChange={e => setForm(f => ({ ...f, board_id: e.target.value }))}>
              <option value="">Nenhum (evento global)</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className={s.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="agenda-data" className="label">Data</label>
              <input id="agenda-data" type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="agenda-horario-opcional" className="label">Horário (opcional)</label>
              <input id="agenda-horario-opcional" type="time" value={form.event_time} onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))} />
            </div>
          </div>
          <div className={s.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="agenda-recorrencia" className="label">Recorrência</label>
              <select id="agenda-recorrencia" value={form.recurrence_type} onChange={e => setForm(f => ({ ...f, recurrence_type: e.target.value }))}>
                <option value="none">Nenhuma</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            {form.recurrence_type !== 'none' && (
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="agenda-repetir-ate-opcional" className="label">Repetir até (opcional)</label>
                <input id="agenda-repetir-ate-opcional" type="date" value={form.recurrence_until} onChange={e => setForm(f => ({ ...f, recurrence_until: e.target.value }))} />
              </div>
            )}
          </div>

          <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
          {formMsg && <p role="alert" className={s.formError}>{formMsg}</p>}

          <div className={s.modalActions}>
            {editing && (
              <button className="btn btn-danger" onClick={deleteEvent}>Excluir evento</button>
            )}
            <button
              className="btn btn-primary"
              style={{ marginLeft: 'auto' }}
              disabled={!form.title.trim() || !form.event_date || saving}
              onClick={saveEvent}
            >
              {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar evento'}
            </button>
          </div>
        </Modal>
      )}

      {dayPopup && (
        <Modal title={formatDayHeader(dayPopup)} onClose={() => setDayPopup(null)} width={420}>
          {(byDay[dayPopup] || []).length === 0 ? (
            <p className={s.popupEmpty}>Nada marcado neste dia.</p>
          ) : (
            <ul className={`${s.events} ${s.popupEvents}`}>
              {(byDay[dayPopup] || []).map(ev => (
                <EventRow key={`${ev.id}-${ev.occurrence_date}`} ev={ev} board={boardById(ev.board_id)}
                  onOpen={() => { setDayPopup(null); openEdit(ev) }} />
              ))}
            </ul>
          )}
          {writable && (
            <button className="btn btn-primary" onClick={() => { const d = dayPopup; setDayPopup(null); openCreate(d) }}>
              <LineIcon name="plus" size={15} /> Novo evento neste dia
            </button>
          )}
        </Modal>
      )}
    </div>
  )
}

// Hora atual "HH:MM" que anda sozinha (a linha "Agora" da lista acompanha o relógio)
function useNowHM() {
  const fmt = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const [now, setNow] = useState(fmt)
  useEffect(() => { const t = setInterval(() => setNow(fmt()), 30_000); return () => clearInterval(t) }, [])
  return now
}

// Uma linha de evento (lista da semana e janela do dia)
function EventRow({ ev, board, past, onOpen }) {
  return (
    <li>
      <div className={`${s.event} ${past ? s.past : ''}`} {...pressable(onOpen)}>
        <span className={s.eventTime}>{ev.event_time || 'Dia todo'}</span>
        <span className={s.eventMain}>
          <span className={s.eventTitle}>{ev.title}</span>
          {ev.description && <span className={s.eventDesc}>{ev.description}</span>}
        </span>
        <span className={s.eventTags}>
          {board && <span className={s.tag}><span className={s.tagDot} style={{ background: board.color || 'var(--brand)' }} />{board.name}</span>}
          {ev.recurrence_type !== 'none' && <span className={s.tag}><LineIcon name="refresh" size={11} />{RECURRENCE_LABEL[ev.recurrence_type] || ev.recurrence_type}</span>}
          {ev.glpi_ticket_id && <span className={s.tag}>Chamado #{ev.glpi_ticket_id}</span>}
        </span>
      </div>
    </li>
  )
}

// Semana em linha do tempo: os 7 dias, hoje com a linha "Agora" entre o que
// já passou (esmaecido) e o que vem.
function WeekView({ weekStart, byDay, boardById, onOpenEvent, onCreate, writable }) {
  const now = useNowHM()
  const todayStr = isoDate(new Date())
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  return (
    <ol className={s.week}>
      {days.map(day => {
        const dateStr = isoDate(day)
        const list = byDay[dateStr] || []
        const isToday = dateStr === todayStr
        const isPast = dateStr < todayStr
        // posição da linha "Agora": antes do 1º evento com horário depois de agora
        let nowAt = -1
        if (isToday) {
          nowAt = list.findIndex(ev => ev.event_time && ev.event_time > now)
          if (nowAt === -1) nowAt = list.length
        }
        return (
          <li key={dateStr} className={`${s.day} ${isToday ? s.dayToday : ''} ${isPast ? s.dayPast : ''}`} aria-current={isToday ? 'date' : undefined}>
            <div className={s.dateCol}>
              <span className={s.dateNum}>{day.getDate()}</span>
              <span className={s.dateWeek}>{isToday ? 'Hoje' : WEEKDAY_LONG[day.getDay()]}</span>
              <span className={s.dateMonth}>{MONTH_LONG[day.getMonth()]}</span>
            </div>
            <div className={s.dayBody}>
              {list.length === 0 ? (
                <div className={s.dayEmpty}>
                  <span>Nada marcado</span>
                  {writable && !isPast && (
                    <button type="button" className={s.addHere} onClick={() => onCreate(dateStr)}>
                      <LineIcon name="plus" size={13} /> Adicionar
                    </button>
                  )}
                  {isToday && <span className={s.nowLine}><span>Agora, {now}</span></span>}
                </div>
              ) : (
                <ul className={s.events}>
                  {list.map((ev, i) => (
                    <Fragment key={`${ev.id}-${ev.occurrence_date}`}>
                      {i === nowAt && <li className={s.nowLine} aria-label={`Agora, ${now}`}><span>Agora, {now}</span></li>}
                      <EventRow ev={ev} board={boardById(ev.board_id)} onOpen={() => onOpenEvent(ev)}
                        past={isPast || (isToday && (i < nowAt))} />
                    </Fragment>
                  ))}
                  {nowAt === list.length && <li className={s.nowLine} aria-label={`Agora, ${now}`}><span>Agora, {now}</span></li>}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Quantos eventos mostrar por dia antes de resumir em "mais N" (o resto fica
// na janela do dia). No celular eles viram pontos pelo CSS.
const MAX_VISIBLE = 3

function CalendarView({ gridStart, gridEnd, monthAnchor, byDay, onOpenEvent, onDayClick }) {
  const maxVisible = MAX_VISIBLE
  const days = []
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  const today = new Date()

  return (
    <div className={s.calendar}>
      <div className={s.calendarWeekHead} aria-hidden="true">
        {WEEKDAY_SHORT.map(w => <span key={w}>{w}</span>)}
      </div>
      <div className={s.calendarGrid}>
        {days.map(day => {
          const dateStr = isoDate(day)
          const dayEvents = byDay[dateStr] || []
          const outside = day.getMonth() !== monthAnchor.getMonth()
          const isToday = isSameDay(day, today)
          const visible = dayEvents.slice(0, maxVisible)
          const extra = dayEvents.length - visible.length

          return (
            <div
              key={dateStr}
              className={`${s.calendarCell} ${outside ? s.outside : ''} ${isToday ? s.today : ''}`}
              {...pressable(() => onDayClick(dateStr))}
              aria-label={`${day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}: ${dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? 'evento' : 'eventos'}` : 'sem eventos'}`}
            >
              <span className={s.calendarDayNum}>{day.getDate()}</span>
              <div className={s.calendarEvents}>
                {visible.map(ev => (
                  <span
                    key={`${ev.id}-${ev.occurrence_date}`}
                    className={s.calendarEventChip}
                    onClick={e => { e.stopPropagation(); onOpenEvent(ev) }}
                    title={`${ev.event_time || 'Dia todo'}: ${ev.title}`}
                  >
                    {ev.event_time && <span className={s.chipTime}>{ev.event_time}</span>}{ev.title}
                  </span>
                ))}
                {extra > 0 && <span className={s.calendarEventMore}>mais {extra}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
