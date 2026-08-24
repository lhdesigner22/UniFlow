import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import DemandModal from '../components/demand/DemandModal'
import s from './ChamadosPage.module.css'

const STATUS_LABELS = {
  aberto:        { label: 'Aberto',       badge: 'badge-blue' },
  em_andamento:  { label: 'Em andamento', badge: 'badge-amber' },
  concluido:     { label: 'Concluído',    badge: 'badge-green' },
  cancelado:     { label: 'Cancelado',    badge: 'badge-gray' },
}

const PRIORITY_LABELS = {
  baixa: { label: 'Baixa', badge: 'badge-green' },
  media: { label: 'Média', badge: 'badge-amber' },
  alta:  { label: 'Alta',  badge: 'badge-red' },
}

export default function ChamadosPage() {
  const [demands, setDemands] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ status: '', department_id: '', month: '' })
  const [modal, setModal] = useState(null) // null | { demand: null|obj }

  useEffect(() => {
    api.get('/departments').then(r => setDepartments(r.data)).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    const params = { type: 'chamado' }
    if (filters.status) params.status = filters.status
    if (filters.department_id) params.department_id = filters.department_id
    if (filters.month) params.month = filters.month
    api.get('/demands', { params })
      .then(r => setDemands(r.data))
      .catch(() => setDemands([]))
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { load() }, [load])

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Chamados</h1>
          <p className={s.pageSub}>Solicitações abertas para outros setores.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ demand: null })}>
          + Novo chamado
        </button>
      </div>

      <div className={s.filters}>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filters.department_id} onChange={e => setFilters(f => ({ ...f, department_id: e.target.value }))}>
          <option value="">Todos os setores</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="month" value={filters.month} onChange={e => setFilters(f => ({ ...f, month: e.target.value }))} />
        {(filters.status || filters.department_id || filters.month) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ status: '', department_id: '', month: '' })}>
            Limpar filtros
          </button>
        )}
      </div>

      {loading ? (
        <div className={s.skeletonList}>
          {[1, 2, 3, 4].map(i => <div key={i} className={s.skeletonRow} />)}
        </div>
      ) : demands.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📋</div>
          <h3>Nenhum chamado encontrado</h3>
          <p>Registre um chamado para acompanhar solicitações a outros setores.</p>
          <button className="btn btn-primary" onClick={() => setModal({ demand: null })}>+ Novo chamado</button>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Título</th>
                <th>Setor</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Criado em</th>
              </tr>
            </thead>
            <tbody>
              {demands.map(d => (
                <tr key={d.id} onClick={() => setModal({ demand: d })} className={s.row}>
                  <td className={s.titleCell}>{d.title}</td>
                  <td>
                    {d.department_name ? (
                      <span className={s.deptDot} style={{ '--dc': d.department_color || 'var(--muted)' }}>
                        <span className={s.dot} /> {d.department_name}
                      </span>
                    ) : <span className={s.muted}>—</span>}
                  </td>
                  <td><span className={`badge ${STATUS_LABELS[d.status]?.badge || 'badge-gray'}`}>{STATUS_LABELS[d.status]?.label || d.status}</span></td>
                  <td>{d.priority ? <span className={`badge ${PRIORITY_LABELS[d.priority]?.badge}`}>{PRIORITY_LABELS[d.priority]?.label}</span> : <span className={s.muted}>—</span>}</td>
                  <td>{d.assigned_to_name || <span className={s.muted}>—</span>}</td>
                  <td>{d.due_date ? new Date(d.due_date).toLocaleDateString('pt-BR') : <span className={s.muted}>—</span>}</td>
                  <td className={s.muted}>{new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <DemandModal type="chamado" demand={modal.demand} onClose={() => setModal(null)} onSaved={() => load()} />
      )}
    </div>
  )
}
