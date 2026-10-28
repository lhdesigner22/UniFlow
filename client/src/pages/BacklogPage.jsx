import { useState, useMemo, useRef, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { useVisiblePolling } from '../hooks/useVisiblePolling'
import { refreshAllGlpi } from '../utils/glpiRefresh'
import Reveal from '../components/common/Reveal'
import TechVisibilityButton from '../components/common/TechVisibilityButton'
import EntityPicker, { NoEntityNotice } from '../components/common/EntityPicker'
import s from './BacklogPage.module.css'

const STATUS_COLORS = {
  1: '#3B82F6', 2: '#06B6D4', 3: '#F59E0B', 4: '#F97316',
  10: '#8B5CF6', 13: '#8B5CF6', 14: '#8B5CF6', 15: '#8B5CF6', 16: '#8B5CF6', 17: '#8B5CF6',
}
const AGE_COLORS = { '0-7 dias': '#22C55E', '8-30 dias': '#F59E0B', '31-90 dias': '#F97316', '90+ dias': '#EF4444' }

// Réplica dos KPIs do "Dashboard de Helpdesk GLPI" (projeto irmão) — os
// códigos de status são específicos dessa instalação do GLPI. `codes` é
// usado pro clique no card filtrar a tabela pelo(s) mesmo(s) status.
//
// Os status 10, 13–17 são filas do TI (SERVICE DESK): Compras, Manutenção, RH,
// Desligamento, Inventário, Eventos. Nos outros departamentos elas viviam
// zeradas — agora só aparecem no SERVICE DESK ou se a fila tiver chamado.
const KPI_DEFS = [
  { key: 'novos', label: 'Novos', codes: ['1'], calc: b => b.byStatus['1'] || 0 },
  { key: 'andamento', label: 'Em andamento / Aguardando', codes: ['2', '3'], calc: b => (b.byStatus['2'] || 0) + (b.byStatus['3'] || 0) },
  { key: 'pendentes', label: 'Pendentes', codes: ['4'], calc: b => b.byStatus['4'] || 0 },
  { key: 'compras', label: 'Compras', codes: ['10'], queue: true, calc: b => b.byStatus['10'] || 0 },
  { key: 'manutencao', label: 'Manutenção', codes: ['13'], queue: true, calc: b => b.byStatus['13'] || 0 },
  { key: 'rh', label: 'RH', codes: ['14'], queue: true, calc: b => b.byStatus['14'] || 0 },
  { key: 'desligamento', label: 'Desligamento', codes: ['15'], queue: true, calc: b => b.byStatus['15'] || 0 },
  { key: 'inventario', label: 'Inventário', codes: ['16'], queue: true, calc: b => b.byStatus['16'] || 0 },
  { key: 'eventos', label: 'Eventos', codes: ['17'], queue: true, calc: b => b.byStatus['17'] || 0 },
]
const TI_ENTITY = 'SERVICE DESK'
const isTiEntity = entity => String(entity || '').toUpperCase().split('>').some(seg => seg.trim() === TI_ENTITY)
const OLD_BUCKETS = ['31-90 dias', '90+ dias']

const PRIORITY_LABEL = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta', 6: 'Crítica' }
const TECH_COLOR = { green: 'var(--success)', amber: 'var(--warning)', red: 'var(--danger)' }
const AGE_BUCKETS_ORDER = ['0-7 dias', '8-30 dias', '31-90 dias', '90+ dias']

function ageBucket(dateCreation) {
  if (!dateCreation) return null
  const created = new Date(String(dateCreation).replace(' ', 'T') + 'Z')
  const days = Math.floor((Date.now() - created.getTime()) / 86400000)
  if (days <= 7) return AGE_BUCKETS_ORDER[0]
  if (days <= 30) return AGE_BUCKETS_ORDER[1]
  if (days <= 90) return AGE_BUCKETS_ORDER[2]
  return AGE_BUCKETS_ORDER[3]
}

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

export default function BacklogPage() {
  const { user } = useAuthStore()
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [techFilter, setTechFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // string vazia, ou código(s) separados por vírgula
  const [monthFilter, setMonthFilter] = useState('')
  const [ageFilter, setAgeFilter] = useState('') // faixa de idade, ou '__old__' = mais de 30 dias
  const [priorityFilter, setPriorityFilter] = useState('') // '' | 'alta' (Alta ou acima)
  const [categoryFilter, setCategoryFilter] = useState('')
  const tableRef = useRef(null)
  // Entidade do GLPI: o departamento da pessoa define qual aparece; quem enxerga todos
  // os departamentos pode escolher (entityChoice vazio = a entidade padrão do servidor).
  const [entityChoice, setEntityChoice] = useState('')
  const [meta, setMeta] = useState({ entity: null, entities: [], noEntity: false })

  const load = () => {
    api.get('/glpi-backlog', { params: entityChoice ? { entity: entityChoice } : {} })
      .then(r => { setSnapshot(r.data?.empty || r.data?.noEntity ? null : r.data); setMeta({ entity: r.data?.entity || null, entities: r.data?.entities || [], noEntity: !!r.data?.noEntity }) })
      .catch(() => {}) // erro numa atualização em segundo plano não deve apagar o snapshot já exibido
      .finally(() => setLoading(false))
  }
  // Atualização "em tempo real": o cron do GLPI roda a cada 1 min pro
  // backlog, então aqui só re-lemos o snapshot já cacheado (leitura barata
  // no D1, sem bater na API do GLPI) — a tela se atualiza sozinha assim que
  // um novo ciclo do cron terminar, sem precisar de F5. O intervalo (60s)
  // acompanha a cadência real do cron — polling mais rápido que isso não
  // traria dado mais novo, só gastaria requisição à toa; e só faz polling
  // com a aba visível (contra o limite de requests/dia do plano Free).
  useVisiblePolling(load, 60_000)
  useEffect(() => { load() }, [entityChoice]) // trocou a entidade → busca de novo

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
  const applyAge = bucket => { setAgeFilter(prev => (prev === bucket ? '' : bucket)); scrollToTable() }
  const applyPriority = p => { setPriorityFilter(prev => (prev === p ? '' : p)); scrollToTable() }
  const applyCategory = c => { setCategoryFilter(prev => (prev === c ? '' : c)); scrollToTable() }
  const clearFilters = () => { setStatusFilter(''); setTechFilter(''); setMonthFilter(''); setAgeFilter(''); setPriorityFilter(''); setCategoryFilter('') }
  const hasActiveFilter = !!(statusFilter || techFilter || monthFilter || ageFilter || priorityFilter || categoryFilter)

  // Trocou de entidade: os filtros de uma não fazem sentido na outra
  useEffect(() => { clearFilters() }, [entityChoice])

  // Técnicos que o Super Admin ocultou nesta entidade (somem do gráfico e do filtro)
  const hiddenTechs = snapshot?.hiddenTechnicians || []
  const visibleTechs = useMemo(() => (snapshot?.byTechnician || []).filter(t => !hiddenTechs.includes(t.name)), [snapshot])
  // Todos os técnicos visíveis (antes cortava em 15 e faltava gente) — o gráfico cresce na altura
  const chartData = visibleTechs
  const categoryData = useMemo(() => (snapshot?.byCategory || []).slice(0, 12), [snapshot])
  const isTi = isTiEntity(meta.entity)
  // Filas do TI: no SERVICE DESK sempre; nos outros só se a fila tiver chamado
  const kpis = useMemo(() => (snapshot ? KPI_DEFS.filter(k => !k.queue || isTi || k.calc(snapshot) > 0) : []), [snapshot, isTi])

  const statusPieData = useMemo(() => {
    if (!snapshot) return []
    return Object.entries(snapshot.byStatus)
      .filter(([, count]) => count > 0)
      .map(([code, count]) => ({ code, name: snapshot.statusLabels[code] || code, value: count }))
      .sort((a, b) => b.value - a.value)
  }, [snapshot])

  const monthlyBarData = useMemo(() => snapshot?.monthlyTrend || [], [snapshot])

  const ageBarData = useMemo(() => {
    if (!snapshot) return []
    return Object.entries(snapshot.byAge).map(([bucket, count]) => ({ bucket, count }))
  }, [snapshot])

  const filteredTickets = useMemo(() => {
    if (!snapshot) return []
    const statusCodes = statusFilter ? statusFilter.split(',') : null
    return snapshot.tickets.filter(t => {
      if (statusCodes && !statusCodes.includes(String(t.status))) return false
      if (techFilter === '__none__' && t.technicians.length > 0) return false
      if (techFilter && techFilter !== '__none__' && !t.technicians.includes(techFilter)) return false
      if (monthFilter && String(t.date_creation || '').slice(0, 7) !== monthFilter) return false
      if (ageFilter === '__old__' && !OLD_BUCKETS.includes(ageBucket(t.date_creation))) return false
      if (ageFilter && ageFilter !== '__old__' && ageBucket(t.date_creation) !== ageFilter) return false
      if (priorityFilter === 'alta' && !(Number(t.priority) >= 4)) return false
      if (categoryFilter && (t.category || 'Sem categoria') !== categoryFilter) return false
      return true
    })
  }, [snapshot, techFilter, statusFilter, monthFilter, ageFilter, priorityFilter, categoryFilter])

  if (loading) return <div className={s.loading}>Carregando backlog...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Backlog de Chamados</h1>
          <p className={s.sub}>Visão somente leitura dos chamados abertos no GLPI ({meta.entity || 'sem entidade'}). Clique em qualquer card ou barra pra filtrar a tabela.</p>
          {snapshot?.glpiPaused && (
            <p style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: 'color-mix(in srgb, var(--danger, #EF4444) 12%, transparent)', color: 'var(--danger, #EF4444)' }}>
              Consultas ao GLPI pausadas (Admin → GLPI) — mostrando o último resumo salvo, sem atualizar.
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
              {refreshing ? 'Atualizando...' : 'Atualizar agora'}
            </button>
          )}
        </div>
      </div>

      {meta.noEntity ? (
        <NoEntityNotice />
      ) : !snapshot ? (
        <div className={s.empty}>
          <h3>Nenhum dado de backlog ainda</h3>
          <p>A primeira sincronização roda automaticamente no próximo ciclo (a cada 1 min). Se você é Super Admin, pode forçar agora no botão acima.</p>
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
              <span className={s.kpiNumber}>{snapshot.totalOpen}</span>
              <span className={s.kpiLabel}>Total em aberto</span>
            </button>
            {kpis.map(k => (
              <button
                key={k.key}
                type="button"
                className={`${s.kpiCard} ${s.kpiClickable} ${statusFilter === k.codes.join(',') ? s.kpiActive : ''}`}
                onClick={() => applyStatus(k.codes.join(','))}
              >
                <span className={s.kpiNumber}>{k.calc(snapshot)}</span>
                <span className={s.kpiLabel}>{k.label}</span>
              </button>
            ))}
            <button
              type="button"
              className={`${s.kpiCard} ${s.kpiWarn} ${s.kpiClickable} ${techFilter === '__none__' ? s.kpiActive : ''}`}
              onClick={() => applyTech('__none__')}
            >
              <span className={s.kpiNumber}>{snapshot.semTecnico}</span>
              <span className={s.kpiLabel}>Sem técnico atribuído</span>
            </button>
            {snapshot.highPriority !== undefined && (
              <button
                type="button"
                className={`${s.kpiCard} ${s.kpiWarn} ${s.kpiClickable} ${priorityFilter === 'alta' ? s.kpiActive : ''}`}
                onClick={() => applyPriority('alta')}
                title="Prioridade Alta, Muito alta ou Crítica"
              >
                <span className={s.kpiNumber}>{snapshot.highPriority}</span>
                <span className={s.kpiLabel}>Alta prioridade</span>
              </button>
            )}
            {snapshot.olderThan30 !== undefined && (
              <button
                type="button"
                className={`${s.kpiCard} ${s.kpiWarn} ${s.kpiClickable} ${ageFilter === '__old__' ? s.kpiActive : ''}`}
                onClick={() => applyAge('__old__')}
                title="Abertos há mais de 30 dias"
              >
                <span className={s.kpiNumber}>{snapshot.olderThan30}</span>
                <span className={s.kpiLabel}>Parados há +30 dias</span>
              </button>
            )}
          </div>

          {/* ── Distribuição por status (largura cheia — cresce com o nº de categorias) ── */}
          <Reveal className={s.chartCard}>
            <h3>Distribuição por status</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, statusPieData.length * 32)}>
              <BarChart data={statusPieData} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'var(--text)', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" onClick={d => d?.payload && applyStatus(d.payload.code)}>
                  {statusPieData.map(d => (
                    <Cell key={d.code} fill={STATUS_COLORS[d.code] || '#94A3B8'} opacity={statusFilter && !statusFilter.split(',').includes(d.code) ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Reveal>

          {/* ── Mês a mês + idade do backlog ── */}
          <div className={s.chartsGrid}>
            <Reveal className={s.chartCard}>
              <h3>Chamados abertos por mês</h3>
              <p className={s.chartNote}>Mês de criação dos chamados que seguem em aberto hoje.</p>
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
              <h3>Idade do backlog</h3>
              <p className={s.chartNote}>Tempo desde a abertura dos chamados ainda em aberto.</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ageBarData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                  <XAxis dataKey="bucket" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={v => [`${v} chamado(s)`, 'Quantidade']}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={d => d?.payload && applyAge(d.payload.bucket)}>
                    {ageBarData.map(d => (
                      <Cell key={d.bucket} fill={AGE_COLORS[d.bucket]} opacity={ageFilter && ageFilter !== d.bucket ? 0.35 : 1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Reveal>
          </div>

          {/* ── Por categoria do GLPI (o que mais muda de um departamento pro outro) ── */}
          {categoryData.length > 0 && (
            <Reveal className={s.chartCard}>
              <h3>Chamados abertos por categoria</h3>
              <p className={s.chartNote}>Categorias do GLPI{snapshot.byCategory.length > categoryData.length ? ` — as ${categoryData.length} com mais chamados` : ''}. Clique numa barra pra filtrar a tabela.</p>
              <ResponsiveContainer width="100%" height={Math.max(140, categoryData.length * 34)}>
                <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={220} tick={{ fill: 'var(--text)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={v => [`${v} chamado(s)`, 'Em aberto']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" fill="var(--brand)" onClick={d => d?.payload && applyCategory(d.payload.name)}>
                    {categoryData.map((c, i) => (
                      <Cell key={i} fill="var(--brand)" opacity={categoryFilter && categoryFilter !== c.name ? 0.35 : 1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Reveal>
          )}

          {/* ── Backlog por técnico ── */}
          <Reveal className={s.chartCard}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <h3>Backlog por técnico</h3>
              <TechVisibilityButton
                entity={meta.entity}
                technicians={snapshot.byTechnician}
                hidden={hiddenTechs}
                onSaved={list => { setSnapshot(prev => ({ ...prev, hiddenTechnicians: list })); setTechFilter(f => (list.includes(f) ? '' : f)) }}
              />
            </div>
            <p className={s.chartNote}>
              {isTi ? 'Chamados abertos, excluindo filas departamentais (Compras/Manutenção/Inventário/Eventos). ' : 'Chamados abertos com técnico atribuído. '}
              Verde ≤3 · Amarelo 4–6 · Vermelho ≥7.
            </p>
            {chartData.length === 0 ? (
              <p className={s.chartEmpty}>Nenhum chamado com técnico atribuído no momento.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={160} interval={0} tick={{ fill: 'var(--text)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={v => [`${v} chamado(s)`, 'Backlog']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" onClick={d => d?.payload && applyTech(d.payload.name)}>
                    {chartData.map((t, i) => (
                      <Cell key={i} fill={TECH_COLOR[t.color]} opacity={techFilter && techFilter !== t.name ? 0.35 : 1} />
                    ))}
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
                {Object.entries(snapshot.statusLabels)
                  .filter(([code]) => !['5', '6'].includes(code) && (isTi || ['1', '2', '3', '4'].includes(code) || snapshot.byStatus[code] > 0))
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
              <select value={ageFilter} onChange={e => setAgeFilter(e.target.value)}>
                <option value="">Qualquer idade</option>
                <option value="__old__">Mais de 30 dias</option>
                {AGE_BUCKETS_ORDER.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {categoryData.length > 0 && (
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                  <option value="">Todas as categorias</option>
                  {snapshot.byCategory.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                </select>
              )}
              <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                <option value="">Qualquer prioridade</option>
                <option value="alta">Alta ou acima</option>
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
                    <th>ID</th><th>Título</th><th>Categoria</th><th>Status</th><th>Prioridade</th>
                    <th>Técnico(s)</th><th>Aberto em</th><th>Modificado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map(t => (
                    <tr key={t.id}>
                      <td className={s.mono}>#{t.id}</td>
                      <td className={s.titleCell} title={t.title}>{t.title}</td>
                      <td className={s.titleCell} title={t.category || ''}>{t.category || <span className={s.noTech}>—</span>}</td>
                      <td><span className="badge badge-blue">{t.statusLabel}</span></td>
                      <td>{PRIORITY_LABEL[t.priority] || t.priority}</td>
                      <td>{t.technicians.length ? t.technicians.join(', ') : <span className={s.noTech}>—</span>}</td>
                      <td className={s.mono}>{fmtGlpiDate(t.date_creation)}</td>
                      <td className={s.mono}>{fmtGlpiDate(t.date_mod)}</td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 && (
                    <tr><td colSpan={8} className={s.chartEmpty}>Nenhum chamado bate com esse filtro.</td></tr>
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
