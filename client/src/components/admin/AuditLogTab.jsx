import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../services/api'
import { parseDbTimestamp } from '../../utils/formatDuration'
import { describe, browserName, CATEGORY_LABEL, SEVERITY_LABEL } from '../../utils/auditLabels'
import { exportAuditXlsx } from '../../utils/exports'
import LineIcon from '../common/LineIcon'
import s from './AuditLogTab.module.css'

// Logs de auditoria (servidor: routes/audit.js). Usado em Admin → Logs e, só com
// a área do Cofre (`fixedCategory="vault"`), no próprio Cofre de Senhas.
// Leitura: Super Admin e Auditor. Não há como editar nem apagar um registro.
const PAGE = 100

const fmtWhen = v => parseDbTimestamp(v)?.toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
}) || '—'

export default function AuditLogTab({ initialCategory = '', fixedCategory = null }) {
  const [category, setCategory] = useState(fixedCategory || initialCategory)
  const [userId, setUserId] = useState('')
  const [onlyAlerts, setOnlyAlerts] = useState(false)
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [summary, setSummary] = useState(null)
  const [people, setPeople] = useState([])
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const params = useCallback(() => {
    const p = {}
    if (category) p.category = category
    if (userId) p.user_id = userId
    if (onlyAlerts) p.severity = 'warning'
    if (qDebounced) p.q = qDebounced
    if (from) p.from = from
    if (to) p.to = to
    return p
  }, [category, userId, onlyAlerts, qDebounced, from, to])

  const load = useCallback(async () => {
    const id = ++reqId.current
    setError(null)
    try {
      const { data } = await api.get('/audit', { params: { ...params(), limit: PAGE } })
      if (id !== reqId.current) return // resposta de um filtro antigo
      setRows(data.rows)
      setHasMore(data.hasMore)
    } catch (e) {
      if (id === reqId.current) setError(e.response?.data?.error || 'Não foi possível carregar os logs.')
    }
  }, [params])

  const loadSummary = useCallback(() => {
    api.get('/audit/summary').then(r => setSummary(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    loadSummary()
    api.get('/audit/people').then(r => setPeople(r.data)).catch(() => {})
  }, [loadSummary])

  const loadMore = async () => {
    if (!rows?.length) return
    setLoadingMore(true)
    try {
      const { data } = await api.get('/audit', { params: { ...params(), limit: PAGE, before: rows[rows.length - 1].id } })
      setRows(prev => [...prev, ...data.rows])
      setHasMore(data.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }

  const doExport = async () => {
    setExporting(true)
    try { await exportAuditXlsx(params()) } finally { setExporting(false) }
  }

  const refresh = () => { load(); loadSummary() }
  const hasFilter = (!fixedCategory && category) || userId || onlyAlerts || q || from || to
  const clear = () => { if (!fixedCategory) setCategory(''); setUserId(''); setOnlyAlerts(false); setQ(''); setFrom(''); setTo('') }

  const v = summary?.vault7d
  const showVaultPanel = !category || category === 'vault'

  return (
    <div className={s.wrap}>
      {showVaultPanel && v && (
        <section className={s.panel} aria-label="Cofre de Senhas nos últimos 7 dias">
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>Cofre de Senhas · últimos 7 dias</h2>
            <span className={s.panelHint}>Inclui as senhas de Wi-Fi das VLANs</span>
          </div>
          <div className={s.kpis}>
            <Kpi label="Aberturas" value={v.opens} />
            <Kpi label="Senhas vistas" value={v.reveals} />
            <Kpi label="Senhas copiadas" value={v.copies} />
            <Kpi label="Itens criados, editados ou excluídos" value={v.changes} />
            <Kpi label="Acessos dados ou tirados" value={v.accessChanges} />
            <Kpi label="Tentativas sem autorização" value={v.denied} danger={v.denied > 0} />
          </div>
          {summary.topRevealers?.length > 0 && (
            <div className={s.top}>
              <span className={s.topLabel}>Quem mais viu ou copiou senhas</span>
              <ul className={s.topList}>
                {summary.topRevealers.map(p => (
                  <li key={p.user_id}>
                    <button type="button" className={s.topPerson} onClick={() => { setUserId(p.user_id); if (!fixedCategory) setCategory('vault') }}>
                      {p.user_name || p.user_email} <strong>{p.n}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className={s.filters}>
        {!fixedCategory && (
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Área">
            <option value="">Todas as áreas</option>
            <option value="vault">Cofre de Senhas</option>
            <option value="change">Alterações</option>
            <option value="page">Telas abertas</option>
            <option value="auth">Entradas e saídas</option>
            <option value="audit">Exportação dos logs</option>
          </select>
        )}
        <select value={userId} onChange={e => setUserId(e.target.value)} aria-label="Pessoa">
          <option value="">Todas as pessoas</option>
          {people.map(p => <option key={p.user_id} value={p.user_id}>{p.user_name || p.user_email}</option>)}
        </select>
        <div className={s.search}>
          <LineIcon name="search" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por item, tela, e-mail ou IP" aria-label="Buscar nos logs" />
        </div>
        <label className={s.date}>De <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className={s.date}>Até <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className={s.check}>
          <input type="checkbox" checked={onlyAlerts} onChange={e => setOnlyAlerts(e.target.checked)} />
          Só alertas
        </label>
        <div className={s.actions}>
          {hasFilter && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Limpar filtros</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}><LineIcon name="refresh" /> Atualizar</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={doExport} disabled={exporting}>
            <LineIcon name="sheet" /> {exporting ? 'Gerando…' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      {error && <p role="alert" className={s.error}>{error}</p>}

      {rows === null ? (
        <p className={s.muted}>Carregando os logs…</p>
      ) : rows.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum registro {hasFilter ? 'com esses filtros' : 'ainda'}</h3>
          <p>{hasFilter ? 'Mude a área, a pessoa ou o período — ou limpe os filtros.' : 'Os registros aparecem aqui assim que alguém usar o sistema.'}</p>
        </div>
      ) : (
        <div className={s.tableCard}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Pessoa</th>
                <th scope="col">O que fez</th>
                <th scope="col">De onde</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = describe(r)
                return (
                  <tr key={r.id} data-severity={r.severity}>
                    <td className={s.when}>{fmtWhen(r.created_at)}</td>
                    <td className={s.who}>
                      <span className={s.person}>{r.user_name || '—'}</span>
                      {r.user_email && <span className={s.sub}>{r.user_email}</span>}
                    </td>
                    <td>
                      <span className={s.what}>
                        {r.severity !== 'info' && <span className={s.sev} data-severity={r.severity}>{SEVERITY_LABEL[r.severity]}</span>}
                        <span className={s.cat} data-category={r.category}>{CATEGORY_LABEL[r.category] || r.category}</span>
                        {d.what}{d.target ? <> · <strong>{d.target}</strong></> : null}
                      </span>
                      {d.note && <span className={s.sub}>{d.note}</span>}
                    </td>
                    <td className={s.from}>
                      <span className={s.mono}>{r.ip || '—'}</span>
                      <span className={s.sub}>{browserName(r.user_agent)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {hasMore && (
            <div className={s.more}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, danger }) {
  return (
    <div className={s.kpi} data-danger={danger || undefined}>
      <span className={s.kpiValue}>{value ?? 0}</span>
      <span className={s.kpiLabel}>{label}</span>
    </div>
  )
}
