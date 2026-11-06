import { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { todayLocalISO } from '../utils/formatDuration'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './ShiftSchedulePage.module.css'

// Time → Escala: quem trabalha onde em cada dia do mês. Quem tem Time "editar"
// liga "Editar escala", escolhe um "pincel" (SEDE, CENTRO, G5, G5/SEDE, ADM...) e clica ou arrasta
// sobre os dias — tudo o que foi pintado num arraste vai numa chamada só.
export const STATUSES = [
  { key: 'SEDE', label: 'SEDE', short: 'SEDE', cls: 'sede' },
  { key: 'CENTRO', label: 'CENTRO', short: 'CTR', cls: 'centro' },
  { key: 'G5', label: 'G5', short: 'G5', cls: 'g5' },
  { key: 'G5_SEDE', label: 'G5/SEDE', short: 'G5/S', cls: 'g5sede' },
  { key: 'ADM', label: 'ADM', short: 'ADM', cls: 'adm' },
  { key: 'FOLGA', label: 'Folga', short: 'F', cls: 'folga' },
  { key: 'FERIAS', label: 'Férias', short: 'FÉR', cls: 'ferias' },
]
const STATUS = Object.fromEntries(STATUSES.map(x => [x.key, x]))
const WORKING = ['SEDE', 'CENTRO', 'G5', 'G5_SEDE', 'ADM']

const pad = n => String(n).padStart(2, '0')
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
function daysOf(month) {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(y, m, 0).getDate()
  return Array.from({ length: n }, (_, i) => {
    const iso = `${month}-${pad(i + 1)}`
    const dow = new Date(y, m - 1, i + 1).getDay()
    return { iso, n: i + 1, dow, weekend: dow === 0 || dow === 6 }
  })
}
const monthLabel = month => new Date(month + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const dayLong = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function PersonModal({ person, onClose, onSaved }) {
  const [form, setForm] = useState({ name: person?.name || '', role_title: person?.role_title || '', hours: person?.hours || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  const save = async () => {
    setSaving(true); setError('')
    try {
      if (person) await api.put(`/shifts/people/${person.id}`, form)
      else await api.post('/shifts/people', form)
      onSaved()
    } catch (e) {
      setError(e.response?.data?.error || 'Não foi possível salvar.')
      setSaving(false)
    }
  }
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title={person ? 'Editar pessoa da escala' : 'Adicionar pessoa à escala'} onClose={onClose} width={460}>
      <div className="form-group">
        <label htmlFor={`${id}-nome`} className="label">Nome</label>
        <input id={`${id}-nome`} autoFocus value={form.name} onChange={set('name')} maxLength={120} />
      </div>
      <div className="form-group">
        <label htmlFor={`${id}-funcao`} className="label">Função (opcional)</label>
        <input id={`${id}-funcao`} value={form.role_title} onChange={set('role_title')} maxLength={80} placeholder="Ex: Auxiliar de T.I." />
      </div>
      <div className="form-group">
        <label htmlFor={`${id}-horario`} className="label">Horário (opcional)</label>
        <input id={`${id}-horario`} value={form.hours} onChange={set('hours')} maxLength={160} placeholder="Ex: Seg a Sex 13h às 22h e Sáb 13h às 17h" />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>
        {saving ? 'Salvando...' : person ? 'Salvar alterações' : 'Adicionar à escala'}
      </button>
    </Modal>
  )
}

export default function ShiftSchedulePage() {
  const { user } = useAuthStore()
  const canEdit = canEditModule(user, 'team')
  const today = todayLocalISO()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [brush, setBrush] = useState('SEDE')
  const [selectedDay, setSelectedDay] = useState(today)
  const [personModal, setPersonModal] = useState(null) // null | {} | pessoa
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (m = month) => {
    try {
      const { data: d } = await api.get('/shifts', { params: { month: m } })
      setData(d); setError('')
    } catch (e) {
      setError(e.response?.data?.error || 'Não foi possível carregar a escala.')
    }
  }, [month])

  useEffect(() => { setData(null); load(month) }, [month]) // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(['shifts'], () => { if (!painting.current) load() })

  const days = useMemo(() => daysOf(month), [month])
  useEffect(() => {
    // dia do painel: hoje se estiver no mês, senão o dia 1
    setSelectedDay(today.startsWith(month) ? today : `${month}-01`)
  }, [month, today])

  const cells = useMemo(() => {
    const m = new Map()
    for (const a of data?.assignments || []) m.set(`${a.person_id}|${a.day}`, a.status)
    return m
  }, [data])
  const people = data?.people || []

  // ── Pintar ──
  const painting = useRef(null) // Map de "pid|dia" → status (o que foi pintado neste arraste)
  const applyLocal = (pid, day, status) => {
    setData(d => {
      const rest = d.assignments.filter(a => !(a.person_id === pid && a.day === day))
      return { ...d, assignments: status ? [...rest, { person_id: pid, day, status }] : rest }
    })
  }
  const paint = (pid, day) => {
    const status = brush === 'CLEAR' ? null : brush
    const key = `${pid}|${day}`
    if (!painting.current || painting.current.has(key)) return
    if ((cells.get(key) || null) === status) { painting.current.set(key, undefined); return }
    painting.current.set(key, status)
    applyLocal(pid, day, status)
  }
  const flush = useCallback(async () => {
    const pending = painting.current
    painting.current = null
    if (!pending) return
    const items = [...pending].filter(([, st]) => st !== undefined).map(([k, status]) => {
      const [person_id, day] = k.split('|')
      return { person_id, day, status }
    })
    if (!items.length) return
    try {
      await api.put('/shifts/assignments', { items })
    } catch (e) {
      alertDialog(e.response?.data?.error || 'Não foi possível salvar a escala. Recarregamos o que está gravado.', { danger: true })
      load()
    }
  }, [load])
  useEffect(() => {
    const up = () => flush()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [flush])

  const cellFromPoint = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cell]')
    return el ? el.dataset.cell.split('|') : null
  }
  const onPointerDown = e => {
    if (!editing || e.button > 0) return
    const hit = cellFromPoint(e)
    if (!hit) return
    e.preventDefault()
    painting.current = new Map()
    paint(hit[0], hit[1])
  }
  const onPointerMove = e => {
    if (!painting.current) return
    const hit = cellFromPoint(e)
    if (hit) paint(hit[0], hit[1])
  }
  const onCellKey = (e, pid, day) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    painting.current = new Map()
    paint(pid, day)
    flush()
  }

  // ── Ações ──
  const move = async (p, dir) => { await api.post(`/shifts/people/${p.id}/move`, { dir }); load() }
  const remove = async p => {
    if (!(await confirmDialog(`Tirar ${p.name} da escala? Todos os dias marcados para essa pessoa, em todos os meses, serão apagados.`, { title: 'Excluir da escala', confirmLabel: 'Excluir' }))) return
    await api.delete(`/shifts/people/${p.id}`)
    load()
  }
  const copyPrevious = async () => {
    const prev = shiftMonth(month, -1)
    if (!(await confirmDialog(`Repetir a escala de ${monthLabel(prev)} em ${monthLabel(month)}? Cada dia recebe o mesmo dia da semana da mesma semana (1º sábado ← 1º sábado). Só os dias ainda vazios são preenchidos.`, { title: 'Repetir mês anterior', danger: false, confirmLabel: 'Repetir' }))) return
    setBusy(true)
    try {
      const { data: r } = await api.post('/shifts/copy', { from: prev, to: month })
      await load()
      alertDialog(r.copied ? `${r.copied} dia(s) preenchido(s).` : `Nada a copiar: ${monthLabel(prev)} não tem dias marcados ou os dias de ${monthLabel(month)} já estão preenchidos.`)
    } catch (e) {
      alertDialog(e.response?.data?.error || 'Não foi possível copiar.', { danger: true })
    } finally { setBusy(false) }
  }
  const exportXlsx = async () => {
    const { downloadShiftXlsx } = await import('../utils/shiftExport')
    await downloadShiftXlsx({ monthLabel: monthLabel(month), statuses: STATUSES, people, days, cells, working: WORKING, author: user?.name })
  }


  // ── Painel do dia ──
  const dayGroups = useMemo(() => {
    const g = Object.fromEntries(STATUSES.map(x => [x.key, []]))
    const none = []
    for (const p of people) {
      const st = cells.get(`${p.id}|${selectedDay}`)
      if (st) g[st].push(p); else none.push(p)
    }
    return { g, none }
  }, [people, cells, selectedDay])
  const workingCount = iso => people.reduce((n, p) => n + (WORKING.includes(cells.get(`${p.id}|${iso}`)) ? 1 : 0), 0)
  const stepDay = delta => {
    const i = days.findIndex(d => d.iso === selectedDay)
    const j = i + delta
    if (j >= 0 && j < days.length) setSelectedDay(days[j].iso)
    else { setMonth(shiftMonth(month, delta)) }
  }

  const monthEmpty = data && !data.assignments.length

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Escala</h1>
          <p className={s.sub}>Quem trabalha onde em cada dia do mês.</p>
        </div>
        <div className={s.actions}>
          <div className={s.monthNav}>
            <button type="button" className={s.navBtn} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><LineIcon name="chevronLeft" /></button>
            <span className={s.monthName} aria-live="polite">{monthLabel(month)}</span>
            <button type="button" className={s.navBtn} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><LineIcon name="chevronRight" /></button>
          </div>
          {!today.startsWith(month) && <button type="button" className="btn btn-ghost" onClick={() => setMonth(today.slice(0, 7))}>Hoje</button>}
          <button type="button" className="btn btn-ghost" onClick={exportXlsx} disabled={!people.length}><LineIcon name="sheet" /> Excel</button>
          {canEdit && (
            <button type="button" className={`btn ${editing ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={editing} onClick={() => setEditing(v => !v)}>
              <LineIcon name={editing ? 'check' : 'edit'} /> {editing ? 'Concluir edição' : 'Editar escala'}
            </button>
          )}
        </div>
      </header>

      {error && <p role="alert" className={s.error}>{error}</p>}
      {!data && !error && <div className={s.loading}>Carregando…</div>}

      {data && (
        <>
          <section className={s.dayPanel} aria-label="Escala do dia">
            <div className={s.dayHead}>
              <button type="button" className={s.navBtn} onClick={() => stepDay(-1)} aria-label="Dia anterior"><LineIcon name="chevronLeft" /></button>
              <div className={s.dayTitle}>
                <span className={s.dayKicker}>{selectedDay === today ? 'Hoje' : 'Dia escolhido'}</span>
                <h2>{dayLong(selectedDay)}</h2>
              </div>
              <button type="button" className={s.navBtn} onClick={() => stepDay(1)} aria-label="Próximo dia"><LineIcon name="chevronRight" /></button>
            </div>
            <div className={s.dayGroups}>
              {STATUSES.filter(x => dayGroups.g[x.key].length).map(x => (
                <div key={x.key} className={s.group}>
                  <span className={`${s.tag} ${s[x.cls]}`}>{x.label}<b>{dayGroups.g[x.key].length}</b></span>
                  <p>{dayGroups.g[x.key].map(p => p.name.split(' ').slice(0, 2).join(' ')).join(', ')}</p>
                </div>
              ))}
              {!STATUSES.some(x => dayGroups.g[x.key].length) && (
                <p className={s.dayEmpty}>{people.length ? 'Ninguém marcado neste dia.' : 'A escala ainda não tem pessoas.'}</p>
              )}
              {dayGroups.none.length > 0 && STATUSES.some(x => dayGroups.g[x.key].length) && (
                <p className={s.noneLine}>Sem marcação: {dayGroups.none.length} pessoa(s)</p>
              )}
            </div>
          </section>

          {editing && (
            <div className={s.toolbar} role="radiogroup" aria-label="Pincel: o que marcar ao clicar nos dias">
              <span className={s.toolLabel}>Marcar como</span>
              {[...STATUSES, { key: 'CLEAR', label: 'Limpar', cls: 'clear' }].map(x => (
                <button key={x.key} type="button" role="radio" aria-checked={brush === x.key}
                  className={`${s.brush} ${s[x.cls]} ${brush === x.key ? s.brushOn : ''}`} onClick={() => setBrush(x.key)}>
                  {x.label}
                </button>
              ))}
              <span className={s.toolHint}>Clique ou arraste sobre os dias.</span>
              <span className={s.toolSpacer} />
              <button type="button" className="btn btn-ghost" onClick={() => setPersonModal({})}><LineIcon name="plus" /> Adicionar pessoa</button>
              <button type="button" className="btn btn-ghost" onClick={copyPrevious} disabled={busy}><LineIcon name="copy" /> Repetir mês anterior</button>
            </div>
          )}

          {!people.length ? (
            <div className={s.emptyBox}>
              <h2>A escala está vazia</h2>
              <p>{canEdit ? 'Clique em "Editar escala" e depois em "Adicionar pessoa" para montar a equipe.' : 'Quem edita o Time ainda não montou a escala.'}</p>
            </div>
          ) : (
            <>
              {monthEmpty && canEdit && !editing && (
                <p className={s.hint}>Nada marcado em {monthLabel(month)}. Use "Editar escala" → "Repetir mês anterior" para começar do mês passado.</p>
              )}
              <div className={`${s.gridWrap} ${editing ? s.isEditing : ''}`}>
                <table className={s.grid} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
                  <thead>
                    <tr>
                      <th scope="col" className={s.personCol}>Colaborador</th>
                      {days.map(d => (
                        <th key={d.iso} scope="col" className={`${s.dayCol} ${d.weekend ? s.weekend : ''} ${d.iso === selectedDay ? s.selCol : ''}`}>
                          <button type="button" className={s.dayBtn} onClick={() => setSelectedDay(d.iso)} aria-label={`Ver ${dayLong(d.iso)}`}>
                            <span className={s.dow}>{DOW[d.dow]}</span>
                            <span className={`${s.dnum} ${d.iso === today ? s.today : ''}`}>{d.n}</span>
                          </button>
                        </th>
                      ))}
                      {editing && <th className={s.menuCol}><span className="sr-only">Ações</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, idx) => (
                      <tr key={p.id}>
                        <th scope="row" className={s.personCol}>
                          <span className={s.pName}>{p.name}</span>
                          {p.role_title && <span className={s.pMeta}>{p.role_title}</span>}
                          {p.hours && <span className={s.pHours}><LineIcon name="clock" />{p.hours}</span>}
                        </th>
                        {days.map(d => {
                          // um bloco por dia, com a sigla do lugar
                          const st = STATUS[cells.get(`${p.id}|${d.iso}`)]
                          const text = st ? st.short : ''
                          const label = `${p.name}, ${dayLong(d.iso)}: ${st ? st.label : 'não marcado'}`
                          const cls = `${s.mark} ${st ? s[st.cls] : s.blank}`
                          return (
                            <td key={d.iso} className={`${s.cell} ${d.weekend ? s.weekend : ''} ${d.iso === selectedDay ? s.selCol : ''}`}>
                              {editing ? (
                                <button type="button" data-cell={`${p.id}|${d.iso}`} className={cls}
                                  aria-label={label} title={label} onKeyDown={e => onCellKey(e, p.id, d.iso)}>
                                  <span className={s.runText} aria-hidden="true">{text}</span>
                                </button>
                              ) : (
                                <span className={cls} title={label}>
                                  <span className={s.runText} aria-hidden="true">{st ? text : '·'}</span>
                                  <span className="sr-only">{st ? st.label : 'não marcado'}</span>
                                </span>
                              )}
                            </td>
                          )
                        })}
                        {editing && (
                          <td className={s.menuCol}>
                            <RowMenu name={p.name} items={[
                              { label: 'Editar dados', icon: 'edit', onClick: () => setPersonModal(p) },
                              idx > 0 && { label: 'Subir', icon: 'chevronUp', onClick: () => move(p, 'up') },
                              idx < people.length - 1 && { label: 'Descer', icon: 'chevronDown', onClick: () => move(p, 'down') },
                              { label: 'Excluir da escala', icon: 'trash', danger: true, onClick: () => remove(p) },
                            ]} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className={s.personCol}>Trabalhando</th>
                      {days.map(d => {
                        const n = workingCount(d.iso)
                        return <td key={d.iso} className={`${s.total} ${d.weekend ? s.weekend : ''} ${d.iso === selectedDay ? s.selCol : ''}`}>{n || ''}</td>
                      })}
                      {editing && <td className={s.menuCol} />}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <ul className={s.legend} aria-label="Legenda">
                {STATUSES.map(x => (
                  <li key={x.key}><span className={`${s.mark} ${s[x.cls]}`}>{x.short}</span>{x.label}</li>
                ))}
                <li><span className={`${s.mark} ${s.blank}`}>·</span>Não marcado</li>
              </ul>
            </>
          )}
        </>
      )}

      {personModal && (
        <PersonModal person={personModal.id ? personModal : null} onClose={() => setPersonModal(null)}
          onSaved={() => { setPersonModal(null); load() }} />
      )}
    </div>
  )
}
