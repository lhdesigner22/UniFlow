import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import Modal from '../components/common/Modal'
import s from './AgendaPage.module.css'

const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTH_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const RECURRENCE_LABEL = { weekly: 'Semanal', monthly: 'Mensal' }

const EMPTY_FORM = { title: '', description: '', board_id: '', event_date: '', event_time: '', recurrence_type: 'none', recurrence_until: '' }

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

export default function AgendaPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState(null)

  const from = isoDate(weekStart)
  const to = isoDate(addDays(weekStart, 6))

  useEffect(() => { api.get('/boards').then(r => setBoards(r.data || [])).catch(() => {}) }, [])

  const loadEvents = useCallback(() => {
    setLoading(true)
    api.get('/events', { params: { from, to } })
      .then(r => setEvents(r.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { loadEvents() }, [loadEvents])

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

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, event_date: from })
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
    if (!confirm('Excluir este evento? Isso remove todas as ocorrências dele.')) return
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
        <button className="btn btn-primary" onClick={openCreate}>+ Novo evento</button>
      </div>

      <div className={s.periodBar}>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(w => addDays(w, -7))} title="Semana anterior">←</button>
        <span className={s.periodLabel}>{formatRangeLabel(from, to)}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(w => addDays(w, 7))} title="Próxima semana">→</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</button>
      </div>

      {loading ? (
        <div className={s.skeleton} />
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
          <button className="btn btn-primary" onClick={openCreate}>+ Novo evento</button>
        </div>
      ) : (
        <div className={s.dayList}>
          {days.map(day => (
            <div key={day} className={s.dayGroup}>
              <div className={s.dayHeader}>{formatDayHeader(day)}</div>
              <div className={s.eventList}>
                {byDay[day].map(ev => {
                  const board = boardById(ev.board_id)
                  return (
                    <div key={`${ev.id}-${ev.occurrence_date}`} className={s.eventRow} onClick={() => openEdit(ev)}>
                      <span className={s.eventTime}>{ev.event_time || 'Dia todo'}</span>
                      <span className={s.eventTitle}>{ev.title}</span>
                      <div className={s.eventBadges}>
                        {board && (
                          <span className={s.boardBadge} style={{ background: (board.color || '#0EA5A5') + '22', color: board.color || '#0EA5A5' }}>
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
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Editar evento' : 'Novo evento'} onClose={() => setShowModal(false)} width={480}>
          <div className="form-group">
            <label className="label">Título</label>
            <input
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Reunião de equipe"
            />
          </div>
          <div className="form-group">
            <label className="label">Descrição (opcional)</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detalhes do evento..."
            />
          </div>
          <div className="form-group">
            <label className="label">Quadro</label>
            <select value={form.board_id} onChange={e => setForm(f => ({ ...f, board_id: e.target.value }))}>
              <option value="">Nenhum (evento global)</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className={s.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Data</label>
              <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Horário (opcional)</label>
              <input type="time" value={form.event_time} onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))} />
            </div>
          </div>
          <div className={s.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Recorrência</label>
              <select value={form.recurrence_type} onChange={e => setForm(f => ({ ...f, recurrence_type: e.target.value }))}>
                <option value="none">Nenhuma</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            {form.recurrence_type !== 'none' && (
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label">Repetir até (opcional)</label>
                <input type="date" value={form.recurrence_until} onChange={e => setForm(f => ({ ...f, recurrence_until: e.target.value }))} />
              </div>
            )}
          </div>

          {formMsg && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{formMsg}</p>}

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
    </div>
  )
}
