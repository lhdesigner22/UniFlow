import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, ResponsiveContainer, Cell } from 'recharts'
import api from '../services/api'
import { downloadFile } from '../utils/download'
import { avatarColor } from '../utils/avatarColor'
import { formatDuration } from '../utils/formatDuration'
import Reveal from '../components/common/Reveal'
import s from './TeamTimePage.module.css'

// Data local em YYYY-MM-DD. `d.toISOString()` converte pra UTC — à noite em
// Brasília (UTC-3) isso pode virar o dia seguinte, deslocando o período
// padrão do filtro em um dia (mesma classe de bug corrigida em CardModal.jsx
// via `todayLocalISO`).
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d }

export default function TeamTimePage() {
  const [boards, setBoards] = useState([])
  const [boardId, setBoardId] = useState('')
  const [from, setFrom] = useState(isoDate(daysAgo(30)))
  const [to, setTo] = useState(isoDate(new Date()))
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { api.get('/boards').then(r => setBoards(r.data || [])).catch(() => {}) }, [])

  const params = useMemo(() => {
    const p = { from, to }
    if (boardId) p.boardId = boardId
    return p
  }, [boardId, from, to])

  useEffect(() => {
    setLoading(true)
    api.get('/time/summary', { params })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [params])

  const byUserChart = (summary?.byUser || []).map(u => ({ ...u, hours: Math.round((u.totalSeconds / 3600) * 10) / 10 }))
  const byDayChart = (summary?.byDay || []).map(d => ({ ...d, hours: Math.round((d.totalSeconds / 3600) * 10) / 10 }))

  const exportCsv = () => {
    const qs = new URLSearchParams(params).toString()
    downloadFile(`/time/export?${qs}`, `tempo-equipe-${from}-a-${to}.csv`)
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className={s.tooltip}>
        <strong>{label}</strong>
        {payload.map((p, i) => <div key={i}>{p.name}: {p.value}h</div>)}
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Tempo da equipe</h1>
          <p className={s.sub}>Acompanhe as horas registradas em cada quadro.</p>
        </div>
        <button className="btn btn-ghost" onClick={exportCsv}>⬇ Exportar CSV</button>
      </div>

      <div className={s.filters}>
        <select value={boardId} onChange={e => setBoardId(e.target.value)}>
          <option value="">Todos os quadros</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <span className={s.rangeSep}>até</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {loading ? (
        <div className={s.skeleton} />
      ) : !summary ? (
        <div className={s.empty}>Não foi possível carregar os dados de tempo.</div>
      ) : (
        <>
          <div className={s.statTile}>
            <span className={s.statNumber}>{formatDuration(summary.totalSeconds)}</span>
            <span className={s.statLabel}>Total registrado no período</span>
          </div>

          <div className={s.chartsGrid}>
            <Reveal className={s.chartCard}>
              <h4>Horas por pessoa</h4>
              {byUserChart.length === 0 ? (
                <p className={s.chartEmpty}>Sem lançamentos no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byUserChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="user_name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" name="Horas" radius={[4, 4, 0, 0]}>
                      {byUserChart.map((u, i) => <Cell key={i} fill={avatarColor(u.user_id)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Reveal>

            <Reveal delay={80} className={s.chartCard}>
              <h4>Tendência diária</h4>
              {byDayChart.length === 0 ? (
                <p className={s.chartEmpty}>Sem lançamentos no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={byDayChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="hours" name="Horas" stroke="var(--brand)" strokeWidth={2} dot={{ fill: 'var(--brand)', r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Reveal>
          </div>
        </>
      )}
    </div>
  )
}
