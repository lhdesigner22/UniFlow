import { useState, useMemo } from 'react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import Modal from './Modal'

// Ocultar técnicos dos gráficos "por técnico" (Total de Chamados e Backlog) —
// ex.: quem saiu da equipe. Vale pra entidade do GLPI escolhida e pra todo mundo;
// só o Super Admin mexe. Os chamados continuam nos totais, só somem do gráfico
// e da lista de filtro. Servidor: PUT /glpi-total/hidden-technicians.
export default function TechVisibilityButton({ entity, technicians, hidden, onSaved }) {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
  if (user?.system_role !== 'super_admin' || !entity) return null
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} title="Escolher quais técnicos aparecem no gráfico">
        👁 Técnicos{hidden.length ? ` (${hidden.length} oculto${hidden.length > 1 ? 's' : ''})` : ''}
      </button>
      {open && <TechVisibilityModal entity={entity} technicians={technicians} hidden={hidden} onClose={() => setOpen(false)} onSaved={list => { onSaved(list); setOpen(false) }} />}
    </>
  )
}

function TechVisibilityModal({ entity, technicians, hidden, onClose, onSaved }) {
  // Quem está no gráfico agora + quem já está oculto (mesmo sem chamado neste período)
  const all = useMemo(() => {
    const counts = new Map(technicians.map(t => [t.name, t.count]))
    for (const n of hidden) if (!counts.has(n)) counts.set(n, null)
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.name.localeCompare(b.name, 'pt-BR'))
  }, [technicians, hidden])
  const [hiddenSet, setHiddenSet] = useState(() => new Set(hidden))
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toggle = name => setHiddenSet(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })
  const q = search.trim().toLowerCase()
  const shown = q ? all.filter(t => t.name.toLowerCase().includes(q)) : all

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = await api.put('/glpi-total/hidden-technicians', { entity, names: [...hiddenSet] })
      onSaved(data.hiddenTechnicians)
    } catch (e) {
      setError(e.response?.data?.error || 'Não deu pra salvar. Tenta de novo?')
      setSaving(false)
    }
  }

  return (
    <Modal title="Técnicos no gráfico" onClose={onClose} width={480}>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Desmarque quem não deve aparecer nos gráficos <strong>por técnico</strong> do Total de Chamados e do Backlog
        ({entity}). Os chamados continuam contando nos totais. Vale para todos que veem esta entidade.
      </p>
      {all.length > 8 && <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar técnico..." style={{ marginBottom: 8 }} />}
      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
        {shown.map(t => (
          <label key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', opacity: hiddenSet.has(t.name) ? 0.55 : 1 }}>
            <input type="checkbox" checked={!hiddenSet.has(t.name)} onChange={() => toggle(t.name)} style={{ width: 'auto' }} />
            <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.count == null ? 'sem chamados aqui' : `${t.count} chamado(s)`}</span>
          </label>
        ))}
        {shown.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nenhum técnico.</span>}
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--danger, #EF4444)', marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => setHiddenSet(new Set())} disabled={!hiddenSet.size}>Mostrar todos</button>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={save} disabled={saving}>
          {saving ? 'Salvando...' : `Salvar${hiddenSet.size ? ` (${hiddenSet.size} oculto${hiddenSet.size > 1 ? 's' : ''})` : ''}`}
        </button>
      </div>
    </Modal>
  )
}
