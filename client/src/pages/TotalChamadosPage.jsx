import { useState, useMemo, useRef, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList, Legend } from 'recharts'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { useVisiblePolling } from '../hooks/useVisiblePolling'
import { refreshAllGlpi } from '../utils/glpiRefresh'
import Reveal from '../components/common/Reveal'
import EntityPicker, { NoEntityNotice } from '../components/common/EntityPicker'
import TechVisibilityButton from '../components/common/TechVisibilityButton'
import s from './TotalChamadosPage.module.css'

const STATUS_COLORS = {
  1: '#3B82F6', 2: '#06B6D4', 3: '#F59E0B', 4: '#F97316', 5: '#22C55E', 6: '#64748B',
  10: '#8B5CF6', 13: '#8B5CF6', 14: '#8B5CF6', 15: '#8B5CF6', 16: '#8B5CF6', 17: '#8B5CF6',
}
const PRIORITY_LABEL = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta', 6: 'Crítica' }
const TECH_COLOR = { green: 'var(--success)', amber: 'var(--warning)', red: 'var(--danger)' }
// Todos os status "em aberto" (todo mundo exceto Resolvido(5)/Fechado(6)) —
// usado pro clique na barra "Em aberto" do resumo filtrar a tabela.
const OPEN_STATUS_CODES = ['1', '2', '3', '4', '10', '13', '14', '15', '16', '17']

function fmtGlpiDate(raw) {
  if (!raw) return '—'
  const [date, time] = raw.split(' ')
  if (!date) return raw
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}${time ? ' ' + time.slice(0, 5) : ''}`
}

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.round(hours / 24)}d`
}

const ORIGIN_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4']
const OTHER_COLOR = '#94A3B8'
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const monthLabel = ym => `${MONTHS_PT[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const tooltipProps = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--text)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--text)' },
}

// "Origem da requisição" do GLPI: ranking de quem mais abre chamado no período
// escolhido (o filtro De/Até vale aqui também) e a evolução mês a mês.
function OriginChart({ snapshot }) {
  const [view, setView] = useState('ranking')
  // "Só setores": esconde os canais (Helpdesk, E-Mail, Sem origem) — lembrado por navegador
  const [sectorsOnly, setSectorsOnly] = useState(() => {
    try { return localStorage.getItem('uniflow.originSectorsOnly') !== '0' } catch { return true }
  })
  const toggleSectors = () => setSectorsOnly(v => {
    try { localStorage.setItem('uniflow.originSectorsOnly', v ? '0' : '1') } catch { /* sem storage */ }
    return !v
  })
  const allOrigins = snapshot.byOrigin || []
  const byOrigin = sectorsOnly ? allOrigins.filter(o => !o.channel) : allOrigins
  const hiddenCount = allOrigins.filter(o => o.channel).reduce((n, o) => n + o.count, 0)
  const total = byOrigin.reduce((n, o) => n + o.count, 0)
  const pctOf = n => (total ? (Math.round((n / total) * 1000) / 10).toLocaleString('pt-BR') : '0')
  const ranking = byOrigin.slice(0, 15).map(o => ({ ...o, pct: pctOf(o.count) }))
  const useSectors = sectorsOnly && snapshot.sectorSeries
  const series = (useSectors ? snapshot.sectorSeries : snapshot.originSeries) || []
  const monthly = ((useSectors ? snapshot.sectorMonthly : snapshot.originMonthly) || []).map(m => ({ ...m, label: monthLabel(m.month) }))
  const colored = series.filter(n => n !== 'Outras' && n !== 'Sem origem')
  const colorOf = name => (colored.includes(name) ? ORIGIN_COLORS[colored.indexOf(name) % ORIGIN_COLORS.length] : OTHER_COLOR)

  return (
    <Reveal className={s.chartCard}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3>Chamados por origem da requisição</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className={s.viewToggle}>
          <button type="button" className={sectorsOnly ? s.viewOn : ''} onClick={toggleSectors} aria-pressed={sectorsOnly}
            title="Esconde Helpdesk, E-Mail e Sem origem (canais de entrada, não setores)">
            {sectorsOnly ? '✓ ' : ''}Só setores
          </button>
        </div>
        <div className={s.viewToggle}>
          <button type="button" className={view === 'ranking' ? s.viewOn : ''} onClick={() => setView('ranking')}>Ranking</button>
          <button type="button" className={view === 'monthly' ? s.viewOn : ''} onClick={() => setView('monthly')}>Mês a mês</button>
        </div>
        </div>
      </div>
      <p className={s.chartNote}>
        {view === 'ranking'
          ? 'Quem mais abriu chamado no período selecionado (use De/Até para ver um mês ou o ano).'
          : `As ${series.filter(n => n !== 'Outras').length} origens que mais abrem chamado, mês a mês (últimos 12 meses com dado).`}
        {sectorsOnly && hiddenCount > 0 && ` Escondidos: ${hiddenCount.toLocaleString('pt-BR')} chamados de Helpdesk, E-Mail e Sem origem.`}
      </p>
      {!snapshot.byOrigin ? (
        <p className={s.chartEmpty}>A origem aparece depois da próxima atualização do Total (a cada 15 min).</p>
      ) : view === 'ranking' ? (
        ranking.length === 0 ? <p className={s.chartEmpty}>Nenhum chamado no período.</p> : (
          <ResponsiveContainer width="100%" height={Math.max(160, ranking.length * 34)}>
            <BarChart data={ranking} layout="vertical" margin={{ top: 5, right: 70, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={170} interval={0} tick={{ fill: 'var(--text)', fontSize: 12 }} />
              <Tooltip {...tooltipProps} formatter={(v, _n, item) => [`${v} chamado(s) · ${item.payload.pct}%`, 'Abertos']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {ranking.map(o => <Cell key={o.name} fill={colorOf(o.name)} />)}
                <LabelList dataKey="count" position="right" formatter={v => `${v} · ${pctOf(v)}%`} style={{ fill: 'var(--text)', fontSize: 12, fontWeight: 700 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      ) : (
        monthly.length === 0 ? <p className={s.chartEmpty}>Sem dados suficientes ainda.</p> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip {...tooltipProps} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="origem" fill={colorOf(name)} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
      )}
    </Reveal>
  )
}

export default function TotalChamadosPage() {
  const { user } = useAuthStore()
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [techFilter, setTechFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // string vazia, ou código(s) separados por vírgula
  const [monthFilter, setMonthFilter] = useState('')
  // Período que filtra TODOS os KPIs/gráficos (não só a tabela) — diferente
  // dos filtros acima, que só recortam a tabela dentro do snapshot já
  // carregado. Aqui muda até o próprio período do snapshot: ao setar,
  // o servidor recalcula tudo (status, prioridade, técnico, taxa de
  // resolução etc.) só com os chamados abertos dentro do intervalo.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const tableRef = useRef(null)
  // Entidade do GLPI: o departamento da pessoa define qual aparece; quem enxerga todos
  // os departamentos pode escolher (entityChoice vazio = a entidade padrão do servidor).
  const [entityChoice, setEntityChoice] = useState('')
  const [meta, setMeta] = useState({ entity: null, entities: [], noEntity: false })

  const load = () => {
    const params = {}
    if (entityChoice) params.entity = entityChoice
    if (dateFrom) params.from = dateFrom
    if (dateTo) params.to = dateTo
    api.get('/glpi-total', { params })
      .then(r => { setSnapshot(r.data?.empty || r.data?.noEntity ? null : r.data); setMeta({ entity: r.data?.entity || null, entities: r.data?.entities || [], noEntity: !!r.data?.noEntity }) })
      .catch(() => {}) // erro numa atualização em segundo plano não deve apagar o snapshot já exibido
      .finally(() => setLoading(false))
  }
  // Recarrega assim que o período muda (os inputs de data já disparam isso
  // sozinhos via onChange — este efeito garante que a mudança de estado
  // realmente vira uma nova consulta, inclusive limpando o período).
  useEffect(() => { load() }, [dateFrom, dateTo, entityChoice])
  // Atualização "em tempo real": o cron do GLPI roda a cada 15 min aqui (o
  // Total varre o histórico completo — mais pesado), então isso só re-lê o
  // snapshot já cacheado (leitura barata no D1) — a tela se atualiza
  // sozinha assim que um novo ciclo terminar, sem precisar de F5. Polling a
  // cada 5 min é mais que suficiente pra um dado que só muda a cada 15
  // (antes era 30s — 30x mais requisições do que o necessário, pesando no
  // limite de requests/dia do plano Free); e só roda com a aba visível.
  useVisiblePolling(load, 5 * 60_000)

  // Atualiza Backlog + Total de Chamados + Eventos da Agenda juntos (mesmo
  // clique, os três dependem do GLPI) — ver client/src/utils/glpiRefresh.js.
  const refreshNow = async () => {
    setRefreshing(true)
    try {
      await refreshAllGlpi()
      load()
    } catch { /* ignora — snapshot cacheado continua valendo */ }
    finally { setRefreshing(false) }
  }

  // Todo elemento clicável do dashboard passa por aqui — aplica o filtro e
  // rola a tela até a tabela, pra deixar óbvio que "clicar atualiza o dash".
  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const applyStatus = codes => { setStatusFilter(prev => (prev === codes ? '' : codes)); scrollToTable() }
  const applyTech = name => { setTechFilter(prev => (prev === name ? '' : name)); scrollToTable() }
  const applyMonth = month => { setMonthFilter(prev => (prev === month ? '' : month)); scrollToTable() }
  const clearFilters = () => { setStatusFilter(''); setTechFilter(''); setMonthFilter('') }
  const hasActiveFilter = !!(statusFilter || techFilter || monthFilter)

  // Técnicos que o Super Admin ocultou nesta entidade (somem do gráfico e do filtro)
  const hiddenTechs = snapshot?.hiddenTechnicians || []
  const visibleTechs = useMemo(() => (snapshot?.byTechnician || []).filter(t => !hiddenTechs.includes(t.name)), [snapshot])
  // Todos os técnicos visíveis (antes cortava em 15 e faltava gente) — o gráfico cresce na altura
  const techChartData = visibleTechs

  const statusBarData = useMemo(() => {
    if (!snapshot) return []
    return Object.entries(snapshot.byStatus)
      .filter(([, count]) => count > 0)
      .map(([code, count]) => ({ code, name: snapshot.statusLabels[code] || code, value: count }))
      .sort((a, b) => b.value - a.value)
  }, [snapshot])

  const summaryBarData = useMemo(() => {
    if (!snapshot) return []
    return [
      { key: 'aberto', name: 'Em aberto', value: snapshot.openCount, color: 'var(--warning)', codes: OPEN_STATUS_CODES.join(',') },
      { key: 'resolvido', name: 'Resolvido', value: snapshot.resolvedCount, color: '#22C55E', codes: '5' },
      { key: 'fechado', name: 'Fechado', value: snapshot.closedCount, color: '#64748B', codes: '6' },
    ].filter(d => d.value > 0)
  }, [snapshot])

  const monthlyBarData = useMemo(() => snapshot?.monthlyTrend || [], [snapshot])

  const filteredTickets = useMemo(() => {
    if (!snapshot) return []
    const statusCodes = statusFilter ? statusFilter.split(',') : null
    return snapshot.tickets.filter(t => {
      if (statusCodes && !statusCodes.includes(String(t.status))) return false
      if (techFilter === '__none__' && t.technicians.length > 0) return false
      if (techFilter && techFilter !== '__none__' && !t.technicians.includes(techFilter)) return false
      if (monthFilter && String(t.date_creation || '').slice(0, 7) !== monthFilter) return false
      return true
    })
  }, [snapshot, techFilter, statusFilter, monthFilter])

  if (loading) return <div className={s.loading}>Carregando total de chamados...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Total de Chamados</h1>
          <p className={s.sub}>Visão histórica completa dos chamados do GLPI ({meta.entity || 'sem entidade'}) — abertos e finalizados. Clique em qualquer card ou barra pra filtrar a tabela.</p>
          {snapshot?.glpiPaused && (
            <p style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: 'color-mix(in srgb, var(--danger, #EF4444) 12%, transparent)', color: 'var(--danger, #EF4444)' }}>
              ⏸️ Consultas ao GLPI pausadas (Admin → GLPI) — mostrando o último resumo salvo, sem atualizar.
            </p>
          )}
        </div>
        <div className={s.headerRight}>
          <EntityPicker entity={meta.entity} entities={meta.entities} onChange={setEntityChoice} />
          {snapshot && <span className={s.updated}>Atualizado {timeAgo(snapshot.updatedAt)}</span>}
          {user?.system_role === 'super_admin' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={refreshNow}
              disabled={refreshing}
              title="Atualiza Backlog, Total de Chamados e Eventos da Agenda juntos"
            >
              {refreshing ? 'Atualizando...' : '🔄 Atualizar agora'}
            </button>
          )}
        </div>
      </div>

      {/* ── Período — filtra TODOS os KPIs/gráficos, não só a tabela ── */}
      <div className={s.periodBar}>
        <label className={s.smallLabel}>
          De
          <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} />
        </label>
        <label className={s.smallLabel}>
          Até
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
        </label>
        {(dateFrom || dateTo) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }}>✕ Ver todo o período</button>
        )}
        {snapshot?.filtered && <span className={s.periodNote}>Mostrando só chamados abertos nesse período</span>}
      </div>

      {meta.noEntity ? (
        <NoEntityNotice />
      ) : !snapshot ? (
        <div className={s.empty}>
          <h3>Nenhum dado ainda</h3>
          <p>A primeira sincronização roda automaticamente no próximo ciclo (a cada 15 min). Se você é Super Admin, pode forçar agora no botão acima.</p>
        </div>
      ) : (
        <>
          {/* ── KPIs (clicáveis) ── */}
          <div className={s.kpiRow}>
            <button
              type="button"
              className={`${s.kpiCard} ${s.kpiTotal} ${s.kpiClickable} ${!hasActiveFilter ? s.kpiActive : ''}`}
              onClick={clearFilters}
              title="Limpar filtros"
            >
              <span className={s.kpiNumber}>{snapshot.totalTickets}</span>
              <span className={s.kpiLabel}>Total de chamados</span>
            </button>
            <div className={`${s.kpiCard} ${s.kpiGood}`}>
              <span className={s.kpiNumber}>{snapshot.resolutionRate}%</span>
              <span className={s.kpiLabel}>Taxa de resolução</span>
            </div>
            <div className={s.kpiCard}>
              <span className={s.kpiNumber}>{snapshot.avgResolutionDays ?? '—'}</span>
              <span className={s.kpiLabel}>Dias médios até resolver</span>
            </div>
            <button
              type="button"
              className={`${s.kpiCard} ${s.kpiClickable} ${statusFilter === '5' ? s.kpiActive : ''}`}
              onClick={() => applyStatus('5')}
            >
              <span className={s.kpiNumber}>{snapshot.resolvedCount}</span>
              <span className={s.kpiLabel}>Resolvidos</span>
            </button>
            <button
              type="button"
              className={`${s.kpiCard} ${s.kpiClickable} ${statusFilter === '6' ? s.kpiActive : ''}`}
              onClick={() => applyStatus('6')}
            >
              <span className={s.kpiNumber}>{snapshot.closedCount}</span>
              <span className={s.kpiLabel}>Fechados</span>
            </button>
            <button
              type="button"
              className={`${s.kpiCard} ${s.kpiWarn} ${s.kpiClickable} ${statusFilter === OPEN_STATUS_CODES.join(',') ? s.kpiActive : ''}`}
              onClick={() => applyStatus(OPEN_STATUS_CODES.join(','))}
            >
              <span className={s.kpiNumber}>{snapshot.openCount}</span>
              <span className={s.kpiLabel}>Ainda em aberto</span>
            </button>
          </div>

          {/* ── Distribuição por status (largura cheia — cresce com o nº de categorias) ── */}
          <Reveal className={s.chartCard}>
            <h3>Distribuição por status</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, statusBarData.length * 32)}>
              <BarChart data={statusBarData} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'var(--text)', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" onClick={d => d?.payload && applyStatus(d.payload.code)}>
                  {statusBarData.map(d => (
                    <Cell key={d.code} fill={STATUS_COLORS[d.code] || '#94A3B8'} opacity={statusFilter && !statusFilter.split(',').includes(d.code) ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Reveal>

          {/* ── Mês a mês + resumo aberto/resolvido/fechado ── */}
          <div className={s.chartsGrid}>
            <Reveal className={s.chartCard}>
              <h3>Chamados criados por mês</h3>
              <p className={s.chartNote}>Volume histórico, últimos meses com dado.</p>
              {monthlyBarData.length === 0 ? (
                <p className={s.chartEmpty}>Sem dados suficientes ainda.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyBarData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: 'var(--text)' }}
                      formatter={v => [`${v} chamado(s)`, 'Criados']}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={d => d?.payload && applyMonth(d.payload.month)}>
                      {monthlyBarData.map(d => (
                        <Cell key={d.month} fill="var(--brand)" opacity={monthFilter && monthFilter !== d.month ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Reveal>

            <Reveal delay={80} className={s.chartCard}>
              <h3>Resumo: aberto x finalizado</h3>
              <p className={s.chartNote}>Todos os chamados da entidade no período selecionado.</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={summaryBarData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={v => [`${v} chamado(s)`, 'Quantidade']}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor="pointer" onClick={d => d?.payload && applyStatus(d.payload.codes)}>
                    {summaryBarData.map(d => (
                      <Cell key={d.key} fill={d.color} opacity={statusFilter && statusFilter !== d.codes ? 0.35 : 1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Reveal>
          </div>

          {/* ── Origem da requisição (campo 9 do GLPI): quem mais abre chamado ── */}
          <OriginChart snapshot={snapshot} />

          {/* ── Por técnico ── */}
          <Reveal className={s.chartCard}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <h3>Chamados por técnico</h3>
              <TechVisibilityButton
                entity={meta.entity}
                technicians={snapshot.byTechnician}
                hidden={hiddenTechs}
                onSaved={list => { setSnapshot(prev => ({ ...prev, hiddenTechnicians: list })); setTechFilter(f => (list.includes(f) ? '' : f)) }}
              />
            </div>
            <p className={s.chartNote}>Todos os chamados já atribuídos (aberto + finalizado), excluindo filas departamentais. Verde ≤3 · Amarelo 4–6 · Vermelho ≥7.</p>
            {techChartData.length === 0 ? (
              <p className={s.chartEmpty}>Nenhum chamado com técnico atribuído.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, techChartData.length * 34)}>
                <BarChart data={techChartData} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={160} interval={0} tick={{ fill: 'var(--text)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={v => [`${v} chamado(s)`, 'Total']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" onClick={d => d?.payload && applyTech(d.payload.name)}>
                    {techChartData.map((t, i) => (
                      <Cell key={i} fill={TECH_COLOR[t.color]} opacity={techFilter && techFilter !== t.name ? 0.35 : 1} />
                    ))}
                    {/* Total escrito dentro da barra (fora dela, se a barra for curta demais). */}
                    <LabelList
                      dataKey="count"
                      content={({ x, y, width, height, value, index }) => {
                        const inside = width >= 34
                        return (
                          <text
                            x={inside ? x + width - 8 : x + width + 6}
                            y={y + height / 2}
                            textAnchor={inside ? 'end' : 'start'}
                            dominantBaseline="central"
                            fill={inside ? (techChartData[index]?.color === 'amber' ? '#111827' : '#fff') : 'var(--text)'}
                            fontSize={12}
                            fontWeight={700}
                            pointerEvents="none"
                          >
                            {value}
                          </text>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Reveal>

          {/* ── Tabela ── */}
          <Reveal ref={tableRef} className={s.tableCard}>
            <div className={s.tableFilters}>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">Todos os status</option>
                {/* Só os status que existem nesta entidade (as filas do TI não aparecem nos outros departamentos) */}
                {Object.entries(snapshot.statusLabels)
                  .filter(([code]) => (snapshot.byStatus?.[code] || 0) > 0)
                  .map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
              </select>
              <select value={techFilter} onChange={e => setTechFilter(e.target.value)}>
                <option value="">Todos os técnicos</option>
                <option value="__none__">Sem técnico</option>
                {visibleTechs.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
              <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                <option value="">Todos os meses</option>
                {monthlyBarData.map(m => (
                  <option key={m.month} value={m.month}>{m.label}</option>
                ))}
              </select>
              {hasActiveFilter && (
                <button className="btn btn-ghost btn-sm" onClick={clearFilters}>✕ Limpar filtros</button>
              )}
              <span className={s.tableCount}>{filteredTickets.length} chamado(s)</span>
            </div>

            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>ID</th><th>Título</th><th>Status</th><th>Prioridade</th>
                    <th>Técnico(s)</th><th>Aberto em</th><th>Modificado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map(t => (
                    <tr key={t.id}>
                      <td className={s.mono}>#{t.id}</td>
                      <td className={s.titleCell} title={t.title}>{t.title}</td>
                      <td><span className="badge badge-blue">{t.statusLabel}</span></td>
                      <td>{PRIORITY_LABEL[t.priority] || t.priority}</td>
                      <td>{t.technicians.length ? t.technicians.join(', ') : <span className={s.noTech}>—</span>}</td>
                      <td className={s.mono}>{fmtGlpiDate(t.date_creation)}</td>
                      <td className={s.mono}>{fmtGlpiDate(t.date_mod)}</td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 && (
                    <tr><td colSpan={7} className={s.chartEmpty}>Nenhum chamado bate com esse filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Reveal>
        </>
      )}
    </div>
  )
}
