import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
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

function isoDate(d) { return d.toISOString().slice(0, 10) }
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

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Agenda</h1>
          <p className={s.sub}>Eventos da equipe, com recorrência semanal ou mensal.</p>
        </div>
        {writable && <button className="btn btn-primary" onClick={() => openCreate()}>+ Novo evento</button>}
      </div>

      <div className={s.periodBar}>
        <button className="btn btn-ghost btn-sm" onClick={goPrev} title={view === 'calendar' ? 'Mês anterior' : 'Semana anterior'}>←</button>
        <span className={s.periodLabel}>{periodLabel}</span>
        <button className="btn btn-ghost btn-sm" onClick={goNext} title={view === 'calendar' ? 'Próximo mês' : 'Próxima semana'}>→</button>
        <button className="btn btn-ghost btn-sm" onClick={goToday}>Hoje</button>

        <div className={s.viewToggle}>
          <button className={`${s.viewToggleBtn} ${view === 'list' ? s.active : ''}`} onClick={() => setView('list')}>📋 Lista</button>
          <button className={`${s.viewToggleBtn} ${view === 'calendar' ? s.active : ''}`} onClick={() => setView('calendar')}>📅 Calendário</button>
        </div>
      </div>

      {loading ? (
        <div className={s.skeleton} />
      ) : view === 'calendar' ? (
        <CalendarView
          gridStart={gridStart}
          gridEnd={gridEnd}
          monthAnchor={monthAnchor}
          byDay={byDay}
          onOpenEvent={openEdit}
          onDayClick={setDayPopup}
        />
      ) : days.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="17" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
            </svg>
          </div>
          <h3>Nenhum evento nesta semana</h3>
          <p>Crie um evento para começar a organizar a agenda da equipe.</p>
          {writable && <button className="btn btn-primary" onClick={() => openCreate()}>+ Novo evento</button>}
        </div>
      ) : (
        <div className={s.dayList}>
          {days.map((day, i) => (
            <Reveal key={day} delay={Math.min(i, 8) * 50} className={s.dayGroup}>
              <div className={s.dayHeader}>{formatDayHeader(day)}</div>
              <div className={s.eventList}>
                {byDay[day].map(ev => {
                  const board = boardById(ev.board_id)
                  return (
                    <div key={`${ev.id}-${ev.occurrence_date}`} className={s.eventRow} {...pressable(() => openEdit(ev))}>
                      <span className={s.eventTime}>{ev.event_time || 'Dia todo'}</span>
                      <span className={s.eventTitle}>{ev.title}</span>
                      <div className={s.eventBadges}>
                        {board && (
                          <span className={s.boardBadge} style={{ background: (board.color || '#3B82F6') + '22', color: board.color || '#3B82F6' }}>
                            {board.name}
                          </span>
                        )}
                        {ev.recurrence_type !== 'none' && (
                          <span className="badge badge-purple">{RECURRENCE_LABEL[ev.recurrence_type] || ev.recurrence_type}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {view === 'calendar' && !loading && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Clique num dia pra ver os eventos dele; clique num evento pra editar direto.</p>
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
          {formMsg && <p role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{formMsg}</p>}

          <div className={s.modalActions}>
            {editing && (
              <button className="btn btn-danger" onClick={deleteEvent}>Excluir</button>
            )}
            <button
              className="btn btn-primary"
              style={{ marginLeft: 'auto' }}
              disabled={!form.title.trim() || !form.event_date || saving}
              onClick={saveEvent}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}

      {dayPopup && (
        <Modal title={formatDayHeader(dayPopup)} onClose={() => setDayPopup(null)} width={420}>
          <div className={s.eventList} style={{ marginBottom: 14 }}>
            {(byDay[dayPopup] || []).length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhum evento neste dia.</p>
            )}
            {(byDay[dayPopup] || []).map(ev => {
              const board = boardById(ev.board_id)
              return (
                <div
                  key={`${ev.id}-${ev.occurrence_date}`}
                  className={s.eventRow}
                  {...pressable(() => { setDayPopup(null); openEdit(ev) })}
                >
                  <span className={s.eventTime}>{ev.event_time || 'Dia todo'}</span>
                  <span className={s.eventTitle}>{ev.title}</span>
                  <div className={s.eventBadges}>
                    {board && (
                      <span className={s.boardBadge} style={{ background: (board.color || '#3B82F6') + '22', color: board.color || '#3B82F6' }}>
                        {board.name}
                      </span>
                    )}
                    {ev.recurrence_type !== 'none' && (
                      <span className="badge badge-purple">{RECURRENCE_LABEL[ev.recurrence_type] || ev.recurrence_type}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {writable && (
          <button className="btn btn-primary" onClick={() => { const d = dayPopup; setDayPopup(null); openCreate(d) }}>
            + Novo evento neste dia
          </button>
          )}
        </Modal>
      )}
    </div>
  )
}

// Quantos eventos mostrar por dia antes de resumir em "+N mais" — em telas
// estreitas, o texto do chip fica ilegível, então mostramos só 1 e deixamos o
// resto pro popup do dia (já existe, e funciona bem como "ver tudo" no mobile).
function useMaxVisibleEvents() {
  const [max, setMax] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 640 ? 1 : 3))
  useEffect(() => {
    const onResize = () => setMax(window.innerWidth <= 640 ? 1 : 3)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return max
}

function CalendarView({ gridStart, gridEnd, monthAnchor, byDay, onOpenEvent, onDayClick }) {
  const maxVisible = useMaxVisibleEvents()
  const days = []
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  const today = new Date()

  return (
    <div>
      <div className={s.calendarWeekHead}>
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
              aria-label={`${day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}: ${dayEvents.length ? `${dayEvents.length} evento(s)` : 'sem eventos'}`}
            >
              <span className={s.calendarDayNum}>{day.getDate()}</span>
              <div className={s.calendarEvents}>
                {visible.map(ev => (
                  <span
                    key={`${ev.id}-${ev.occurrence_date}`}
                    className={s.calendarEventChip}
                    onClick={e => { e.stopPropagation(); onOpenEvent(ev) }}
                    title={`${ev.event_time || 'Dia todo'} — ${ev.title}`}
                  >
                    {ev.event_time ? `${ev.event_time} ` : ''}{ev.title}
                  </span>
                ))}
                {extra > 0 && <span className={s.calendarEventMore}>+{extra} mais</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
