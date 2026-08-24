import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import DemandModal from '../components/demand/DemandModal'
import s from './EventosPage.module.css'

const STATUS_LABELS = {
  aberto:        { label: 'Aberto',       badge: 'badge-blue' },
  em_andamento:  { label: 'Em andamento', badge: 'badge-amber' },
  concluido:     { label: 'Concluído',    badge: 'badge-green' },
  cancelado:     { label: 'Cancelado',    badge: 'badge-gray' },
}

export default function EventosPage() {
  const [demands, setDemands] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ department_id: '', month: '' })
  const [modal, setModal] = useState(null)

  useEffect(() => {
    api.get('/departments').then(r => setDepartments(r.data)).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    const params = { type: 'evento' }
    if (filters.department_id) params.department_id = filters.department_id
    if (filters.month) params.month = filters.month
    api.get('/demands', { params })
      .then(r => setDemands([...r.data].sort((a, b) => new Date(a.event_date || 0) - new Date(b.event_date || 0))))
      .catch(() => setDemands([]))
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { load() }, [load])

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Eventos</h1>
          <p className={s.pageSub}>Agenda de eventos programados, ordenada por data.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ demand: null })}>
          + Novo evento
        </button>
      </div>

      <div className={s.filters}>
        <select value={filters.department_id} onChange={e => setFilters(f => ({ ...f, department_id: e.target.value }))}>
          <option value="">Todos os setores</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="month" value={filters.month} onChange={e => setFilters(f => ({ ...f, month: e.target.value }))} />
        {(filters.department_id || filters.month) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ department_id: '', month: '' })}>
            Limpar filtros
          </button>
        )}
      </div>

      {loading ? (
        <div className={s.skeletonList}>
          {[1, 2, 3].map(i => <div key={i} className={s.skeletonRow} />)}
        </div>
      ) : demands.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📅</div>
          <h3>Nenhum evento encontrado</h3>
          <p>Agende um evento para que ele apareça aqui e no painel de KPIs.</p>
          <button className="btn btn-primary" onClick={() => setModal({ demand: null })}>+ Novo evento</button>
        </div>
      ) : (
        <div className={s.list}>
          {demands.map(d => (
            <div key={d.id} className={s.item} onClick={() => setModal({ demand: d })}>
              <div className={s.itemDate}>
                <span className={s.itemDay}>{d.event_date ? new Date(d.event_date).getDate() : '—'}</span>
                <span className={s.itemMonth}>{d.event_date ? new Date(d.event_date).toLocaleDateString('pt-BR', { month: 'short' }) : ''}</span>
              </div>
              <div className={s.itemBody}>
                <div className={s.itemTop}>
                  <h3 className={s.itemTitle}>{d.title}</h3>
                  <span className={`badge ${STATUS_LABELS[d.status]?.badge || 'badge-gray'}`}>{STATUS_LABELS[d.status]?.label || d.status}</span>
                </div>
                <div className={s.itemMeta}>
                  {d.event_date && (
                    <span>🕐 {new Date(d.event_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                  {d.location && <span>📍 {d.location}</span>}
                  {d.department_name && (
                    <span className={s.deptDot} style={{ '--dc': d.department_color || 'var(--muted)' }}>
                      <span className={s.dot} /> {d.department_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <DemandModal type="evento" demand={modal.demand} onClose={() => setModal(null)} onSaved={() => load()} />
      )}
    </div>
  )
}
