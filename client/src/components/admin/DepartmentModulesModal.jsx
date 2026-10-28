import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import s from './RolesTab.module.css'

// O que um departamento enxerga: por área, um TETO sobre o cargo de quem é do
// departamento. "Conforme o cargo" não muda nada; "Só ver" tira a edição;
// "Oculto" some do menu. Super Admin e Auditor não são afetados.
const OPTIONS = [
  { key: 'none', label: 'Oculto', hint: 'Some do menu para quem é do departamento' },
  { key: 'view', label: 'Só ver', hint: 'Mesmo que o cargo permita editar, só consulta' },
  { key: 'edit', label: 'Conforme o cargo', hint: 'Vale o que o cargo da pessoa permite' },
]

export default function DepartmentModulesModal({ dept, modules, onClose, onSaved }) {
  const [limits, setLimits] = useState(() => Object.fromEntries(modules.map(m => [m.key, dept.module_limits?.[m.key] || 'edit'])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setAll = level => setLimits(Object.fromEntries(modules.map(m => [m.key, level])))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = await api.put(`/admin/departments/${dept.id}`, { module_limits: limits })
      onSaved(data)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar.')
      setSaving(false)
    }
  }

  const hidden = modules.filter(m => limits[m.key] === 'none').length

  return (
    <Modal title={`O que aparece para ${dept.name}`} onClose={onClose} width={680}>
      <p className={s.lockNote} style={{ marginBottom: 12 }}>
        Vale para quem é deste departamento, por cima do cargo: o departamento só <em>esconde</em> ou <em>restringe</em> — nunca dá mais acesso do que o cargo já dá. Super Admin e Auditor sempre veem tudo.
      </p>
      <div className={s.matrixHead}>
        <h3 className={s.matrixTitle}>{hidden ? `${hidden} área(s) oculta(s)` : 'Todas as áreas conforme o cargo'}</h3>
        <div className={s.quick}>
          <span>Marcar tudo:</span>
          {OPTIONS.map(o => <button key={o.key} type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(o.key)}>{o.label}</button>)}
        </div>
      </div>
      <div className={s.matrixWrap}>
        <table className={s.matrix}>
          <thead>
            <tr>
              <th>Área</th>
              {OPTIONS.map(o => <th key={o.key} title={o.hint}>{o.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {modules.map(m => (
              <tr key={m.key}>
                <td>
                  <div className={s.modName}>{m.label}</div>
                  <div className={s.modHint}>{m.hint}</div>
                </td>
                {OPTIONS.map(o => (
                  <td key={o.key} className={`${s.cell} ${limits[m.key] === o.key ? s[`on_${o.key}`] : ''}`}>
                    <input
                      type="radio" name={`dept-${m.key}`} style={{ width: 'auto' }}
                      checked={limits[m.key] === o.key}
                      onChange={() => setLimits(l => ({ ...l, [m.key]: o.key }))}
                      aria-label={`${m.label}: ${o.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className={`${s.msg} ${s.err}`}>{error}</p>}
      <div className={s.actions}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  )
}
