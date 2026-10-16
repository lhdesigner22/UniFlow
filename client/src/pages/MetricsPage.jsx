import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, ResponsiveContainer, Cell, Legend } from 'recharts'
import api from '../services/api'
import { avatarColor } from '../utils/avatarColor'
import Reveal from '../components/common/Reveal'
import s from './MetricsPage.module.css'

// Mesmo cuidado de fuso do TeamTimePage.jsx — `toISOString()` desloca a data
// à noite em Brasília (UTC-3), por isso monta a data local manualmente.
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d }

export default function MetricsPage() {
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
    api.get('/metrics/summary', { params })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [params])

  const byUserChart = summary?.byUser || []
  const byBoardChart = summary?.byBoard || []
  const trendChart = summary?.completedOverTime || []
  const overdueChart = summary?.overdueByBoard || []

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className={s.tooltip}>
        <strong>{label}</strong>
        {payload.map((p, i) => <div key={i}>{p.name}: {p.value}</div>)}
      </div>
    )
  }

  const t = summary?.totals

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Métricas</h1>
          <p className={s.sub}>Quem concluiu o quê, em quantos quadros e tarefas — no estilo do Planner.</p>
        </div>
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
        <div className={s.empty}>Não foi possível carregar as métricas.</div>
      ) : (
        <>
          <div className={s.statsRow}>
            <div className={s.statTile}>
              <span className={s.statNumber}>{t.total}</span>
              <span className={s.statLabel}>Tarefas criadas no período</span>
            </div>
            <div className={s.statTile}>
              <span className={`${s.statNumber} ${s.green}`}>{t.completed}</span>
              <span className={s.statLabel}>Concluídas</span>
            </div>
            <div className={s.statTile}>
              <span className={`${s.statNumber} ${s.amber}`}>{t.inProgress}</span>
              <span className={s.statLabel}>Em andamento</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statNumber}>{t.notStarted}</span>
              <span className={s.statLabel}>Não iniciadas</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statNumber}>{t.completionRate}%</span>
              <span className={s.statLabel}>Taxa de conclusão</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statNumber}>{t.boardsCount}</span>
              <span className={s.statLabel}>Quadros visíveis</span>
            </div>
            <div className={s.statTile}>
              <span className={`${s.statNumber} ${s.red}`}>{t.overdue}</span>
              <span className={s.statLabel}>Atrasadas agora</span>
            </div>
          </div>

          <div className={s.chartsGrid}>
            <Reveal className={s.chartCard}>
              <h4>Concluídas por pessoa</h4>
              {byUserChart.length === 0 ? (
                <p className={s.chartEmpty}>Ninguém concluiu tarefas no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byUserChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="user_name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="completed" name="Concluídas" radius={[4, 4, 0, 0]}>
                      {byUserChart.map((u, i) => <Cell key={i} fill={avatarColor(u.user_id)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Reveal>

            <Reveal delay={80} className={s.chartCard}>
              <h4>Tarefas por quadro</h4>
              {byBoardChart.length === 0 ? (
                <p className={s.chartEmpty}>Nenhum quadro visível.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byBoardChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="board_name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="total" name="Criadas" fill="var(--border2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Concluídas" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Reveal>

            <Reveal delay={160} className={s.chartCard}>
              <h4>Cards atrasados por quadro</h4>
              {overdueChart.length === 0 ? (
                <p className={s.chartEmpty}>Nenhum card atrasado. 🎉</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={overdueChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="board_name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="overdue" name="Atrasadas" fill="var(--danger)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Reveal>

            <Reveal delay={240} className={s.chartCard}>
              <h4>Conclusões ao longo do tempo</h4>
              {trendChart.length === 0 ? (
                <p className={s.chartEmpty}>Sem conclusões no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="completed" name="Concluídas" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} />
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
