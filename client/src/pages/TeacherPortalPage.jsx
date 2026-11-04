import { useState, useEffect, useCallback, useId } from 'react'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { confirmDialog } from '../store/dialogStore'
import ConfirmDialogHost from '../components/common/ConfirmDialogHost'
import LineIcon from '../components/common/LineIcon'
import s from './TeacherPortalPage.module.css'

// Portal do Professor: tela única de quem tem o cargo Professor (sem o menu do
// app). Pedir Chromebooks (a TI confirma) e abrir chamado no GLPI. De propósito
// sem tempo real e sem sininho: professores são muitos e o plano grátis tem
// limite de chamadas por dia — a lista recarrega ao abrir e quando a aba volta.

const REQUEST_STATUS = {
  pendente: { label: 'Aguardando a TI', tone: 'warn' },
  aprovada: { label: 'Confirmado', tone: 'ok' },
  recusada: { label: 'Recusado', tone: 'bad' },
  cancelada: { label: 'Cancelado', tone: 'muted' },
}
// Situação do chamado no GLPI (os status 10+ são filas internas da TI).
const ticketStatus = n => ({ 1: 'Novo', 2: 'Em atendimento', 3: 'Em atendimento', 4: 'Aguardando', 5: 'Solucionado', 6: 'Fechado' }[n] || 'Em atendimento')
const ticketTone = n => (n === 5 || n === 6 ? 'ok' : n === 4 ? 'warn' : 'info')
const KIND_ICON = { computador: 'monitor', projetor: 'tv', internet: 'wifi', acesso: 'key', outro: 'wrench' }

const firstName = n => String(n || '').trim().split(/\s+/)[0] || ''
function dayLabel(iso, today) {
  const d = new Date(`${iso}T12:00:00`)
  const diff = Math.round((d - new Date(`${today}T12:00:00`)) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
}
const errorOf = (e, fallback) => e?.response?.data?.error || fallback

export default function TeacherPortalPage() {
  const { user, logout } = useAuthStore()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [open, setOpen] = useState(null) // 'reserve' | 'ticket' | null
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try { setData((await api.get('/teacher/overview')).data); setLoadError('') }
    catch (e) { setLoadError(errorOf(e, 'Não deu para carregar. Verifique a internet e tente de novo.')) }
  }, [])
  useEffect(() => { load() }, [load])
  // Sem tempo real: recarrega quando a pessoa volta para a aba.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const done = msg => { setOpen(null); setNotice(msg); load() }
  const toggleForm = which => { setNotice(''); setOpen(o => (o === which ? null : which)) }

  const today = data?.today
  const upcoming = (data?.requests || []).filter(r => r.use_date >= today).sort((a, b) => (a.use_date + a.start_time).localeCompare(b.use_date + b.start_time))
  const past = (data?.requests || []).filter(r => r.use_date < today)

  return (
    <div className={s.shell}>
      <header className={s.top}>
        <span className={s.brand}><span className={s.mark} aria-hidden="true"><LineIcon name="laptop" size={16} /></span><span>Uni<em>FLOW</em></span></span>
        <span className={s.topActions}>
          <button type="button" className={s.textBtn} onClick={logout}><LineIcon name="logout" size={15} /> Sair</button>
        </span>
      </header>

      <main id="conteudo" className={s.page}>
        <h1 className={s.hello}>Olá{user?.name ? `, ${firstName(user.name)}` : ''}</h1>
        <p className={s.sub}>Peça Chromebooks para a sua aula ou avise a TI de um problema.</p>

        <div className={s.actions}>
          <button type="button" className={`${s.action} ${open === 'reserve' ? s.actionOn : ''}`} aria-expanded={open === 'reserve'} onClick={() => toggleForm('reserve')}>
            <LineIcon name="laptop" size={26} />
            <span><strong>Reservar Chromebooks</strong><small>A TI confirma por e-mail</small></span>
          </button>
          <button type="button" className={`${s.action} ${open === 'ticket' ? s.actionOn : ''}`} aria-expanded={open === 'ticket'} onClick={() => toggleForm('ticket')}>
            <LineIcon name="wrench" size={26} />
            <span><strong>Abrir chamado</strong><small>Projetor, internet, computador...</small></span>
          </button>
        </div>

        {notice && <p className={s.notice} role="status"><LineIcon name="check" size={16} /> {notice}</p>}
        {open === 'reserve' && data && <ReserveForm data={data} onDone={done} onCancel={() => setOpen(null)} />}
        {open === 'ticket' && data && <TicketForm data={data} onDone={done} onCancel={() => setOpen(null)} />}
        {loadError && <p className={s.error} role="alert">{loadError}</p>}

        {data && (
          <>
            <section className={s.section} aria-labelledby="minhas-reservas">
              <h2 id="minhas-reservas" className={s.sectionTitle}>Minhas reservas</h2>
              {upcoming.length === 0 && <p className={s.empty}>Nenhuma reserva marcada. Use "Reservar Chromebooks" para pedir para uma aula.</p>}
              <ul className={s.list}>
                {upcoming.map(r => <RequestRow key={r.id} r={r} today={today} data={data} onChanged={load} />)}
              </ul>
              {past.length > 0 && (
                <details className={s.past}>
                  <summary>Reservas que já passaram ({past.length})</summary>
                  <ul className={s.list}>{past.map(r => <RequestRow key={r.id} r={r} today={today} data={data} />)}</ul>
                </details>
              )}
            </section>

            <section className={s.section} aria-labelledby="meus-chamados">
              <h2 id="meus-chamados" className={s.sectionTitle}>Meus chamados</h2>
              {data.tickets.length === 0 && <p className={s.empty}>Nenhum chamado aberto por aqui. Se algo não funcionar na sala, use "Abrir chamado".</p>}
              <ul className={s.list}>
                {data.tickets.map(t => (
                  <li key={t.id} className={s.row}>
                    <span className={s.rowIcon} aria-hidden="true"><LineIcon name={KIND_ICON[t.kind] || 'wrench'} size={18} /></span>
                    <span className={s.rowMain}>
                      <span className={s.rowTitle}>{data.kinds[t.kind] || 'Chamado'}</span>
                      <span className={s.rowMeta}>Nº {t.glpi_ticket_id} · {data.buildings[t.building] || t.building}{t.room ? `, ${t.room}` : ''}</span>
                    </span>
                    <span className={`${s.pill} ${s[ticketTone(t.glpi_status)]}`}>{ticketStatus(t.glpi_status)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {!data && !loadError && <p className={s.empty}>Carregando…</p>}
      </main>
      <ConfirmDialogHost />
    </div>
  )
}

function RequestRow({ r, today, data, onChanged }) {
  const st = REQUEST_STATUS[r.status] || REQUEST_STATUS.pendente
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const canCancel = onChanged && ['pendente', 'aprovada'].includes(r.status)
  const cancel = async () => {
    if (!(await confirmDialog('Cancelar esta reserva? A TI fica sabendo.'))) return
    setBusy(true); setErr('')
    try { await api.post(`/teacher/chromebook-requests/${r.id}/cancel`); onChanged() }
    catch (e) { setErr(errorOf(e, 'Não deu para cancelar.')); setBusy(false) }
  }
  return (
    <li className={`${s.row} ${s.reqRow}`}>
      <span className={s.when}>
        <strong>{dayLabel(r.use_date, today)}</strong>
        <span>{r.start_time}–{r.end_time}</span>
      </span>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>{r.quantity} Chromebook{r.quantity > 1 ? 's' : ''}</span>
        <span className={s.rowMeta}>{data.buildings[r.building] || r.building}, {r.room}</span>
        {r.decision_note && <span className={s.note}>{r.status === 'recusada' ? 'Motivo' : 'TI'}: {r.decision_note}</span>}
        {err && <span className={s.errorSmall} role="alert">{err}</span>}
      </span>
      <span className={s.rowEnd}>
        <span className={`${s.pill} ${s[st.tone]}`}>{st.label}</span>
        {canCancel && <button type="button" className={s.linkBtn} onClick={cancel} disabled={busy}>Cancelar</button>}
      </span>
    </li>
  )
}

function BuildingField({ id, value, onChange, buildings }) {
  return (
    <div className={s.field}>
      <label className="label" htmlFor={id}>Prédio</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} required>
        <option value="">Escolha…</option>
        {Object.entries(buildings).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  )
}

function ReserveForm({ data, onDone, onCancel }) {
  const uid = useId()
  const [f, setF] = useState({ use_date: data.today, start_time: '', end_time: '', building: '', room: '', quantity: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await api.post('/teacher/chromebook-requests', { ...f, quantity: Number(f.quantity) })
      onDone('Pedido enviado. Você recebe a confirmação da TI por e-mail.')
    } catch (e2) { setErr(errorOf(e2, 'Não deu para enviar o pedido.')); setBusy(false) }
  }
  return (
    <form className={s.form} onSubmit={submit}>
      <h2 className={s.formTitle}>Reservar Chromebooks</h2>
      <div className={s.grid}>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-d`}>Dia da aula</label>
          <input id={`${uid}-d`} type="date" min={data.today} value={f.use_date} onChange={e => set('use_date', e.target.value)} required />
        </div>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-q`}>Quantidade</label>
          <input id={`${uid}-q`} type="number" inputMode="numeric" min="1" max="60" value={f.quantity} onChange={e => set('quantity', e.target.value)} required />
        </div>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-s`}>Das</label>
          <input id={`${uid}-s`} type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)} required />
        </div>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-e`}>Até</label>
          <input id={`${uid}-e`} type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)} required />
        </div>
        <BuildingField id={`${uid}-b`} value={f.building} onChange={v => set('building', v)} buildings={data.buildings} />
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-r`}>Sala</label>
          <input id={`${uid}-r`} value={f.room} onChange={e => set('room', e.target.value)} placeholder="Ex.: Sala 12" maxLength={80} required />
        </div>
      </div>
      <div className={s.field}>
        <label className="label" htmlFor={`${uid}-n`}>Observação (opcional)</label>
        <textarea id={`${uid}-n`} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} maxLength={500} placeholder="Ex.: preciso dos carregadores" />
      </div>
      {err && <p className={s.error} role="alert">{err}</p>}
      <div className={s.formBtns}>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Pedir Chromebooks'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Fechar</button>
      </div>
    </form>
  )
}

function TicketForm({ data, onDone, onCancel }) {
  const uid = useId()
  const [f, setF] = useState({ kind: '', building: '', room: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async e => {
    e.preventDefault()
    if (!f.kind) { setErr('Escolha o tipo de problema.'); return }
    setBusy(true); setErr('')
    try {
      const { data: t } = await api.post('/teacher/tickets', f)
      onDone(`Chamado nº ${t.glpi_ticket_id} aberto. A TI responde pelo GLPI e por e-mail.`)
    } catch (e2) { setErr(errorOf(e2, 'Não deu para abrir o chamado.')); setBusy(false) }
  }
  return (
    <form className={s.form} onSubmit={submit}>
      <h2 className={s.formTitle}>Abrir chamado</h2>
      <fieldset className={s.kinds}>
        <legend className="label">O que está com problema?</legend>
        {Object.entries(data.kinds).map(([k, label]) => (
          <label key={k} className={`${s.kind} ${f.kind === k ? s.kindOn : ''}`}>
            <input type="radio" name={`${uid}-kind`} value={k} checked={f.kind === k} onChange={() => set('kind', k)} />
            <LineIcon name={KIND_ICON[k]} size={18} /> {label}
          </label>
        ))}
      </fieldset>
      <div className={s.grid}>
        <BuildingField id={`${uid}-b`} value={f.building} onChange={v => set('building', v)} buildings={data.buildings} />
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-r`}>Sala</label>
          <input id={`${uid}-r`} value={f.room} onChange={e => set('room', e.target.value)} placeholder="Ex.: Lab 3" maxLength={80} />
        </div>
      </div>
      <div className={s.field}>
        <label className="label" htmlFor={`${uid}-d`}>Conte o que aconteceu</label>
        <textarea id={`${uid}-d`} rows={4} value={f.description} onChange={e => set('description', e.target.value)} maxLength={2000} required
          placeholder="Ex.: o projetor da sala não liga desde ontem; já testei outra tomada." />
      </div>
      {err && <p className={s.error} role="alert">{err}</p>}
      <div className={s.formBtns}>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Abrindo…' : 'Abrir chamado'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Fechar</button>
      </div>
    </form>
  )
}
