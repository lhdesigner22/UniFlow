import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, Legend } from 'recharts'
import api from '../services/api'
import s from './ReportsPage.module.css'

const COLORS_PIE = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6']
const PRIORITY_COLORS = { high:'#ef4444', medium:'#f59e0b', low:'#22c55e' }

export default function ReportsPage() {
  const { pipeId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [pipe, setPipe] = useState(null)

  useEffect(() => {
    api.get(`/pipes/${pipeId}/reports`).then(r => setData(r.data))
    api.get(`/pipes/${pipeId}`).then(r => setPipe(r.data))
  }, [pipeId])

  if (!data || !pipe) return <div className={s.loading}>Carregando relatórios...</div>

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className={s.tooltip}>
        <strong>{label}</strong>
        {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: {p.value}</div>)}
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/pipe/${pipeId}`)}>← Voltar</button>
        <h2>📊 Relatórios — {pipe.name}</h2>
      </div>

      <div className={s.body}>
        {/* KPI Cards */}
        <div className={s.kpis}>
          <div className={s.kpi}>
            <div className={s.kpiVal} style={{ color:'var(--blue)' }}>{data.totalCards}</div>
            <div className={s.kpiLabel}>Cards Ativos</div>
          </div>
          <div className={s.kpi}>
            <div className={s.kpiVal} style={{ color:'var(--green)' }}>{data.completedCards}</div>
            <div className={s.kpiLabel}>Concluídos</div>
          </div>
          <div className={s.kpi}>
            <div className={s.kpiVal} style={{ color:'var(--red)' }}>{data.overdueCards}</div>
            <div className={s.kpiLabel}>Atrasados</div>
          </div>
          <div className={s.kpi}>
            <div className={s.kpiVal} style={{ color:'var(--muted)' }}>{data.archivedCards}</div>
            <div className={s.kpiLabel}>Arquivados</div>
          </div>
        </div>

        <div className={s.charts}>
          {/* Cards por Fase */}
          <div className={s.chartCard}>
            <h4>Cards por Fase</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.phaseStats} margin={{ top:5, right:10, left:-20, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                <XAxis dataKey="name" tick={{ fill:'var(--muted)', fontSize:11 }} />
                <YAxis tick={{ fill:'var(--muted)', fontSize:11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" name="Total" fill="#4a7cf7" radius={[4,4,0,0]} />
                <Bar dataKey="overdue" name="Atrasados" fill="#ef4444" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Por Prioridade */}
          <div className={s.chartCard}>
            <h4>Distribuição por Prioridade</h4>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.priorityStats.map(p => ({ name: { high:'Alta', medium:'Média', low:'Baixa' }[p.priority], value: p.count }))}
                  cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                  {data.priorityStats.map((_, i) => <Cell key={i} fill={Object.values(PRIORITY_COLORS)[i]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Cards criados últimos 7 dias */}
          <div className={s.chartCard}>
            <h4>Cards criados — últimos 7 dias</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.last7} margin={{ top:5, right:10, left:-20, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                <XAxis dataKey="day" tick={{ fill:'var(--muted)', fontSize:11 }} />
                <YAxis tick={{ fill:'var(--muted)', fontSize:11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="count" name="Cards" stroke="#22c55e" strokeWidth={2} dot={{ fill:'#22c55e', r:4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Atividade por Membro */}
          <div className={s.chartCard}>
            <h4>Atividade por Membro</h4>
            {data.memberActivity.length === 0 ? (
              <p style={{ color:'var(--muted)', fontSize:13, padding:'20px 0' }}>Nenhuma atividade registrada.</p>
            ) : (
              <div className={s.memberList}>
                {data.memberActivity.map((m, i) => (
                  <div key={i} className={s.memberItem}>
                    <div className="avatar" style={{ background: COLORS_PIE[i % COLORS_PIE.length], fontSize:11 }}>{m.name.charAt(0)}</div>
                    <span className={s.memberName}>{m.name}</span>
                    <div className={s.memberBar}>
                      <div className={s.memberFill} style={{ width: `${(m.actions / data.memberActivity[0].actions) * 100}%`, background: COLORS_PIE[i % COLORS_PIE.length] }} />
                    </div>
                    <span className={s.memberCount}>{m.actions}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
