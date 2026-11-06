import { useState, useEffect, useMemo, useId } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../services/api'
import Avatar from '../components/common/Avatar'
import LineIcon from '../components/common/LineIcon'
import s from './MetricsPage.module.css'

// Métricas dos quadros: o período é lido numa frase (o que mais importa: quanto o
// time concluiu), depois quem concluiu, cada quadro e o ritmo dia a dia.

// Data local (toISOString é UTC: depois das 21h de Brasília já seria amanhã).
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d }
const PRESETS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const brDay = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}` }

// Todos os dias do período, com zero onde ninguém concluiu (a linha antiga pulava esses dias).
function fillDays(from, to, rows) {
  const byDate = new Map(rows.map(r => [r.date, r.completed]))
  const out = []
  const d = new Date(`${from}T12:00:00`), end = new Date(`${to}T12:00:00`)
  for (let i = 0; d <= end && i < 400; i++, d.setDate(d.getDate() + 1)) {
    const iso = isoDate(d)
    out.push({ date: iso, label: brDay(iso), completed: byDate.get(iso) || 0 })
  }
  return out
}

function periodText(from, to, preset) {
  if (preset) return `Nos últimos ${preset} dias`
  return `De ${brDay(from)} a ${brDay(to)}`
}

export default function MetricsPage() {
  const uid = useId()
  const [boards, setBoards] = useState([])
  const [boardId, setBoardId] = useState('')
  const [from, setFrom] = useState(isoDate(daysAgo(30)))
  const [to, setTo] = useState(isoDate(new Date()))
  const [preset, setPreset] = useState(30)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { api.get('/boards').then(r => setBoards(r.data || [])).catch(() => {}) }, [])

  const params = useMemo(() => ({ from, to, ...(boardId ? { boardId } : {}) }), [boardId, from, to])
  useEffect(() => {
    setLoading(true)
    api.get('/metrics/summary', { params })
      .then(r => { setSummary(r.data); setError('') })
      .catch(e => { setSummary(null); setError(e?.response?.data?.error || 'Não deu para carregar as métricas. Tente de novo.') })
      .finally(() => setLoading(false))
  }, [params])

  const choosePreset = days => { setPreset(days); setFrom(isoDate(daysAgo(days))); setTo(isoDate(new Date())) }
  const setDate = (which, v) => { setPreset(null); which === 'from' ? setFrom(v) : setTo(v) }
  const [customOpen, setCustomOpen] = useState(false)
  const fmtShort = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

  const t = summary?.totals
  const people = summary?.byUser || []
  const unassigned = summary?.unassignedCompleted || 0
  const topPerson = Math.max(1, unassigned, ...people.map(p => p.completed))
  const overdueBy = new Map((summary?.overdueByBoard || []).map(b => [b.board_id, b.overdue]))
  const boardRows = (summary?.byBoard || []).map(b => ({ ...b, overdue: overdueBy.get(b.board_id) || 0 }))
  const days = useMemo(() => fillDays(from, to, summary?.completedOverTime || []), [from, to, summary])
  const boardName = boards.find(b => b.id === boardId)?.name

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Métricas</h1>
        <p className={s.sub}>O que o time concluiu nos quadros, quem concluiu e como está cada quadro.</p>
      </header>

      <div className={s.filters}>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-b`}>Quadro</label>
          <select id={`${uid}-b`} value={boardId} onChange={e => setBoardId(e.target.value)}>
            <option value="">Todos os quadros</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className={s.presets} role="group" aria-label="Período">
          {PRESETS.map(([d, label]) => (
            <button key={d} type="button" className={`${s.preset} ${preset === d ? s.presetOn : ''}`} aria-pressed={preset === d} onClick={() => choosePreset(d)}>{label}</button>
          ))}
        </div>
        {!customOpen && (
          <button type="button" className={`${s.preset} ${s.customBtn} ${preset === null ? s.presetOn : ''}`} aria-expanded={false} onClick={() => setCustomOpen(true)}>
            <LineIcon name="calendar" size={14} /> {preset === null ? `${fmtShort(from)} a ${fmtShort(to)}` : 'Outro período'}
          </button>
        )}
        {customOpen && (<>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-f`}>De</label>
          <input id={`${uid}-f`} type="date" value={from} max={to} onChange={e => setDate('from', e.target.value)} />
        </div>
        <div className={s.field}>
          <label className="label" htmlFor={`${uid}-t`}>Até</label>
          <input id={`${uid}-t`} type="date" value={to} min={from} onChange={e => setDate('to', e.target.value)} />
        </div>
        <button type="button" className={`btn btn-ghost btn-sm ${s.customDone}`} onClick={() => setCustomOpen(false)}>Pronto</button>
        </>)}
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}
      {loading && !summary && <div className={s.skeleton} aria-label="Carregando" />}

      {summary && t && (
        <div className={`${s.body} ${loading ? s.stale : ''}`}>
          {/* ── A leitura do período ── */}
          <section className={s.lead} aria-label="Resumo do período">
            {t.total === 0 ? (
              <p className={s.sentence}>{periodText(from, to, preset)}, nenhuma tarefa foi criada{boardName ? ` em ${boardName}` : ' nos quadros'}.</p>
            ) : (
              <p className={s.sentence}>
                {periodText(from, to, preset)}, o time concluiu <strong>{t.completed}</strong> das <strong>{t.total}</strong> tarefas criadas
                {boardName ? ` em ${boardName}` : ' no período'} <span className={s.rate}>({t.completionRate}%)</span>.
              </p>
            )}
            {t.total > 0 && (
              <>
                <div className={s.bar} role="img" aria-label={`${t.completed} concluídas, ${t.inProgress} em andamento, ${t.notStarted} não iniciadas`}>
                  <span className={s.segDone} style={{ width: `${pct(t.completed, t.total)}%` }} />
                  <span className={s.segDoing} style={{ width: `${pct(t.inProgress, t.total)}%` }} />
                  <span className={s.segTodo} style={{ width: `${pct(t.notStarted, t.total)}%` }} />
                </div>
                <ul className={s.legend}>
                  <li><i className={s.dotDone} /> {t.completed} concluídas</li>
                  <li><i className={s.dotDoing} /> {t.inProgress} em andamento</li>
                  <li><i className={s.dotTodo} /> {t.notStarted} não iniciadas</li>
                  {t.overdue > 0 && <li className={s.overdue}><i className={s.dotLate} /> {t.overdue} atrasada{t.overdue > 1 ? 's' : ''} agora</li>}
                </ul>
              </>
            )}
          </section>

          <div className={s.grid}>
            {/* ── Quem concluiu ── */}
            <section className={s.panel} aria-labelledby={`${uid}-people`}>
              <h2 id={`${uid}-people`} className={s.panelTitle}>Quem concluiu</h2>
              {people.length === 0 && !unassigned ? (
                <p className={s.empty}>Ninguém concluiu tarefas no período.</p>
              ) : (
                <ol className={s.people}>
                  {people.map(p => (
                    <li key={p.user_id} className={s.person}>
                      <Avatar id={p.user_id} name={p.user_name} size={28} />
                      <span className={s.personName}>{p.user_name}</span>
                      <span className={s.personBar} aria-hidden="true"><span style={{ width: `${(p.completed / topPerson) * 100}%` }} /></span>
                      <span className={s.personNum}>{p.completed}</span>
                    </li>
                  ))}
                  {unassigned > 0 && (
                    <li className={`${s.person} ${s.personNone}`}>
                      <span className={s.noneIcon} aria-hidden="true"><LineIcon name="user" size={14} /></span>
                      <span className={s.personName}>Sem responsável<small>Tarefas concluídas sem ninguém marcado no cartão</small></span>
                      <span className={s.personBar} aria-hidden="true"><span style={{ width: `${(unassigned / topPerson) * 100}%` }} /></span>
                      <span className={s.personNum}>{unassigned}</span>
                    </li>
                  )}
                </ol>
              )}
            </section>

            {/* ── Cada quadro ── */}
            <section className={s.panel} aria-labelledby={`${uid}-boards`}>
              <h2 id={`${uid}-boards`} className={s.panelTitle}>Por quadro</h2>
              {boardRows.length === 0 ? (
                <p className={s.empty}>Nenhum quadro visível para você.</p>
              ) : (
                <table className={s.table}>
                  <thead>
                    <tr><th scope="col">Quadro</th><th scope="col">Criadas</th><th scope="col">Concluídas</th><th scope="col" className={s.colBar}>Progresso</th><th scope="col">Atrasadas</th></tr>
                  </thead>
                  <tbody>
                    {boardRows.map(b => (
                      <tr key={b.board_id}>
                        <th scope="row"><span className={s.boardDot} style={{ background: b.board_color || 'var(--brand)' }} aria-hidden="true" />{b.board_name}</th>
                        <td data-label="Criadas">{b.total}</td>
                        <td data-label="Concluídas">{b.completed}</td>
                        <td className={s.colBar} data-label="Progresso"><span className={s.miniBar} aria-label={`${pct(b.completed, b.total)}% concluído`}><span style={{ width: `${pct(b.completed, b.total)}%` }} /></span><span className={s.miniPct}>{pct(b.completed, b.total)}%</span></td>
                        <td className={b.overdue ? s.lateCell : s.mutedCell} data-label="Atrasadas">{b.overdue || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* ── Ritmo ── */}
          <section className={s.panel} aria-labelledby={`${uid}-days`}>
            <h2 id={`${uid}-days`} className={s.panelTitle}>Concluídas por dia</h2>
            {days.every(d => !d.completed) ? (
              <p className={s.empty}>Nenhuma conclusão no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={days} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'color-mix(in srgb, var(--text) 6%, transparent)' }}
                    content={({ active, payload, label }) => active && payload?.length ? (
                      <div className={s.tooltip}><strong>{label}</strong> · {payload[0].value} concluída{payload[0].value === 1 ? '' : 's'}</div>
                    ) : null} />
                  <Bar dataKey="completed" fill="var(--success)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
