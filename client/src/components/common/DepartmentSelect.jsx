import { useEffect } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useDepartmentStore } from '../../store/departmentStore'

// Escolha do departamento de um conteúdo. Só aparece pra quem enxerga TODOS os
// departamentos (os demais criam sempre no próprio — o servidor força). `value`
// vazio/null = "Geral" (visível a todos os departamentos).
export default function DepartmentSelect({ value, onChange, label = 'Departamento' }) {
  const { user } = useAuthStore()
  const { departments, loaded, fetch } = useDepartmentStore()
  useEffect(() => { if (!loaded) fetch() }, [loaded])

  if (user?.scope !== 'all') return null
  return (
    <div className="form-group">
      <label className="label">{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">Geral (todos os departamentos)</option>
        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </div>
  )
}
