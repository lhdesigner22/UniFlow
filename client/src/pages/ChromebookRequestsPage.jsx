import { useState, useEffect, useCallback, useId } from 'react'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { canEdit } from '../utils/permissions'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import LineIcon from '../components/common/LineIcon'
import s from './ChromebookRequestsPage.module.css'

// Empréstimos → Pedidos de Chromebook: o que os professores pediram pelo Portal
// do Professor. A TI confirma ou recusa (com motivo); o professor recebe por e-mail.
const BUILDINGS = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }
const STATUS = {
  pendente: { label: 'Esperando resposta', tone: 'warn' },
  aprovada: { label: 'Confirmado', tone: 'ok' },
  recusada: { label: 'Recusado', tone: 'bad' },
  cancelada: { label: 'Cancelado pelo professor', tone: 'muted' },
}

function dayHeading(iso, today) {
  const d = new Date(`${iso}T12:00:00`)
  const diff = Math.round((d - new Date(`${today}T12:00:00`)) / 86400000)
  const long = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  if (diff === 0) return `Hoje, ${long}`
  if (diff === 1) return `Amanhã, ${long}`
  return long.charAt(0).toUpperCase() + long.slice(1)
}

export default function ChromebookRequestsPage() {
  const { user } = useAuthStore()
  const editable = canEdit(user, 'loans')
  const [range, setRange] = useState('upcoming')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setData((await api.get('/chromebook-requests', { params: { range } })).data); setError('') }
    catch (e) { setError(e?.response?.data?.error || 'Não deu para carregar os pedidos.') }
  }, [range])
  useEffect(() => { setData(null); load() }, [load])
  useLiveRefresh(['teacher', 'chromebook-requests'], load)

  const rows = data?.requests || []
  const waiting = rows.filter(r => r.status === 'pendente').length
  const days = []
  for (const r of rows) {
    const last = days[days.length - 1]
    if (last?.date === r.use_date) last.items.push(r)
    else days.push({ date: r.use_date, items: [r] })
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Pedidos de Chromebook</h1>
        <p className={s.sub}>
          {range === 'upcoming'
            ? (waiting ? `${waiting} pedido${waiting > 1 ? 's' : ''} esperando resposta. ` : 'Nenhum pedido esperando resposta. ')
            : 'Pedidos de dias que já passaram. '}
          O professor recebe a confirmação ou a recusa por e-mail.
        </p>
      </header>

      <div className={s.tabs} role="tablist" aria-label="Período">
        {[['upcoming', 'Próximos'], ['past', 'Já passaram']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={range === k} className={`${s.tab} ${range === k ? s.tabOn : ''}`} onClick={() => setRange(k)}>{label}</button>
        ))}
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}
      {!data && !error && <p className={s.empty}>Carregando…</p>}
      {data && rows.length === 0 && (
        <div className={s.emptyBox}>
          <LineIcon name="laptop" size={28} />
          <p>{range === 'upcoming' ? 'Nenhum pedido para os próximos dias. Os professores pedem pelo Portal do Professor.' : 'Nenhum pedido nos dias anteriores.'}</p>
        </div>
      )}

      {days.map(day => (
        <section key={day.date} className={s.day} aria-label={dayHeading(day.date, data.today)}>
          <h2 className={s.dayTitle}>{dayHeading(day.date, data.today)}</h2>
          <ul className={s.list}>
            {day.items.map(r => <RequestRow key={r.id} r={r} editable={editable && range === 'upcoming'} onChanged={load} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function RequestRow({ r, editable, onChanged }) {
  const uid = useId()
  const st = STATUS[r.status] || STATUS.pendente
  const [refusing, setRefusing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const decide = async (decision, decisionNote) => {
    setBusy(true); setErr('')
    try { await api.post(`/chromebook-requests/${r.id}/decision`, { decision, note: decisionNote }); setRefusing(false); onChanged() }
    catch (e) { setErr(e?.response?.data?.error || 'Não deu para salvar a decisão.') }
    finally { setBusy(false) }
  }
  const canDecide = editable && r.status !== 'cancelada'

  return (
    <li className={`${s.row} ${r.status === 'cancelada' ? s.rowOff : ''}`}>
      <span className={s.time}>{r.start_time}<small>até {r.end_time}</small></span>
      <span className={s.main}>
        <span className={s.what}><strong>{r.quantity}</strong> Chromebook{r.quantity > 1 ? 's' : ''} · {BUILDINGS[r.building] || r.building}, {r.room}</span>
        <span className={s.who}>{r.requester_name} · {r.requester_email}</span>
        {r.notes && <span className={s.notes}>"{r.notes}"</span>}
        {r.decision_note && <span className={s.decision}>{r.status === 'recusada' ? 'Motivo' : 'Observação'}: {r.decision_note}{r.decided_by_name ? ` — ${r.decided_by_name}` : ''}</span>}
        {refusing && (
          <span className={s.refuse}>
            <label className="label" htmlFor={`${uid}-m`}>Motivo da recusa (vai para o professor)</label>
            <span className={s.refuseRow}>
              <input id={`${uid}-m`} value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Ex.: todos os Chromebooks do G5 já estão reservados" autoFocus />
              <button type="button" className="btn btn-sm btn-danger" disabled={busy || !note.trim()} onClick={() => decide('recusada', note)}>Recusar</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRefusing(false)}>Voltar</button>
            </span>
          </span>
        )}
        {err && <span className={s.error} role="alert">{err}</span>}
      </span>
      <span className={s.end}>
        <span className={`${s.pill} ${s[st.tone]}`}>{st.label}</span>
        {canDecide && !refusing && (
          <span className={s.btns}>
            {r.status !== 'aprovada' && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => decide('aprovada')}><LineIcon name="check" size={14} /> Confirmar</button>}
            {r.status !== 'recusada' && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setNote(''); setRefusing(true) }}>Recusar</button>}
          </span>
        )}
      </span>
    </li>
  )
}
