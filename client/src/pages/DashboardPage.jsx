import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, Legend } from 'recharts'
import api from '../services/api'
import { downloadFile } from '../utils/download'
import { useAuthStore } from '../store/authStore'
import s from './DashboardPage.module.css'

const STATUS_META = {
  abertos:       { label: 'Abertos',       color: '#3b7eff' },
  em_andamento:  { label: 'Em andamento',  color: '#d97706' },
  concluidos:    { label: 'Concluídos',    color: '#16a34a' },
  cancelados:    { label: 'Cancelados',    color: '#64748b' },
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth())
  const [kpis, setKpis] = useState(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    api.get('/demands/kpis', { params: { month } })
      .then(r => setKpis(r.data))
      .catch(() => setKpis(null))
      .finally(() => setLoading(false))
  }, [month])

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className={s.tooltip}>
        <strong>{label}</strong>
        {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: {p.value}</div>)}
      </div>
    )
  }

  const isEmpty = !loading && kpis && kpis.totals.total === 0
  const statusData = kpis ? Object.entries(STATUS_META).map(([key, meta]) => ({
    name: meta.label, value: kpis.totals[key] || 0, color: meta.color,
  })).filter(d => d.value > 0) : []

  return (
    <div className={s.page}>

      {/* ── Header ── */}
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Painel de KPIs</h1>
          <p className={s.pageSub}>
            Bem-vindo, <strong>{user?.name?.split(' ')[0]}</strong>
            {user?.department_name ? ` · ${user.department_name}` : ''}
          </p>
        </div>
        <div className={s.headerActions}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={s.monthInput} />
          <button className="btn btn-ghost" onClick={() => downloadFile(`/demands/export?month=${month}`, `demandas-${month}.csv`)}>
            ⬇ Exportar CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className={s.grid}>
          {[1, 2, 3, 4].map(i => <div key={i} className={s.skeleton} />)}
        </div>
      ) : isEmpty ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <h3>Nenhuma demanda em {month}</h3>
          <p>Registre um chamado para começar a acompanhar as demandas do mês.</p>
          <button className="btn btn-primary" onClick={() => navigate('/chamados')}>+ Novo chamado</button>
        </div>
      ) : kpis && (
        <>
          {/* ── Stats ── */}
          <div className={s.statsRow}>
            <div className={s.statItem}>
              <span className={s.statNumber}>{kpis.totals.total}</span>
              <span className={s.statLabel}>Total de demandas</span>
            </div>
            <div className={s.statDivider} />
            <div className={s.statItem}>
              <span className={s.statNumber}>{kpis.completionRate}%</span>
              <span className={s.statLabel}>Taxa de conclusão</span>
            </div>
            <div className={s.statDivider} />
            <div className={s.statItem}>
              <span className={s.statNumber}>{kpis.avgResolutionDays != null ? Math.round(kpis.avgResolutionDays * 10) / 10 : '—'}{kpis.avgResolutionDays != null ? ' dias' : ''}</span>
              <span className={s.statLabel}>Tempo médio de resolução</span>
            </div>
            <div className={s.statDivider} />
            <div className={s.statItem}>
              <span className={s.statNumber}>{kpis.totals.eventos}</span>
              <span className={s.statLabel}>Eventos no mês</span>
            </div>
          </div>

          {/* ── Quick actions ── */}
          <div className={s.quickGrid}>
            <div className={s.quickCard} onClick={() => navigate('/chamados')}>
              <div className={s.quickAccent} style={{ background: 'var(--blue)' }} />
              <div className={s.quickBody}>
                <span className={s.quickIcon}>📋</span>
                <div>
                  <h3>Ver chamados</h3>
                  <p>{kpis.totals.chamados} chamado{kpis.totals.chamados !== 1 ? 's' : ''} neste mês</p>
                </div>
              </div>
            </div>
            <div className={s.quickCard} onClick={() => navigate('/eventos')}>
              <div className={s.quickAccent} style={{ background: 'var(--green)' }} />
              <div className={s.quickBody}>
                <span className={s.quickIcon}>📅</span>
                <div>
                  <h3>Ver eventos</h3>
                  <p>{kpis.totals.eventos} evento{kpis.totals.eventos !== 1 ? 's' : ''} neste mês</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Charts ── */}
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <h2 className={s.sectionTitle}>Análise do mês</h2>
            </div>
            <div className={s.chartsGrid}>
              <div className={s.chartCard}>
                <h4>Demandas por setor</h4>
                {kpis.byDepartment.length === 0 ? (
                  <p className={s.chartEmpty}>Sem dados de setor neste mês.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={kpis.byDepartment} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                      <XAxis dataKey="department_name" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="total" name="Total" fill="#3b7eff" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="concluidos" name="Concluídos" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={s.chartCard}>
                <h4>Distribuição por status</h4>
                {statusData.length === 0 ? (
                  <p className={s.chartEmpty}>Sem dados de status neste mês.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                        {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={s.chartCard} style={{ gridColumn: '1 / -1' }}>
                <h4>Comparação mês a mês (últimos 6 meses)</h4>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={kpis.monthlyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#3b7eff" strokeWidth={2} dot={{ fill: '#3b7eff', r: 4 }} />
                    <Line type="monotone" dataKey="completionRate" name="Taxa de conclusão (%)" stroke="#16a34a" strokeWidth={2} dot={{ fill: '#16a34a', r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Upcoming events ── */}
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <h2 className={s.sectionTitle}>Próximos eventos</h2>
              {kpis.upcomingEvents?.length > 0 && <span className={s.sectionCount}>{kpis.upcomingEvents.length}</span>}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/eventos')}>
                Ver todos →
              </button>
            </div>
            {(!kpis.upcomingEvents || kpis.upcomingEvents.length === 0) ? (
              <div className={s.empty} style={{ padding: '40px 24px' }}>
                <p>Nenhum evento programado.</p>
              </div>
            ) : (
              <div className={s.eventsList}>
                {kpis.upcomingEvents.map(ev => (
                  <div key={ev.id} className={s.eventItem} onClick={() => navigate('/eventos')}>
                    <span className={s.eventDot} style={{ background: ev.department_color || 'var(--blue)' }} />
                    <span className={s.eventTitle}>{ev.title}</span>
                    <span className={s.eventDept}>{ev.department_name}</span>
                    <span className={s.eventDate}>
                      {ev.event_date ? new Date(ev.event_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
