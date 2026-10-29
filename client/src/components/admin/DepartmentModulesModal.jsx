import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import LevelSwitch from './LevelSwitch'
import s from './RolesTab.module.css'

// O que um departamento enxerga: por área, um TETO sobre o cargo de quem é do
// departamento. "Conforme o cargo" não muda nada; "Só ver" tira a edição;
// "Oculto" some do menu. Super Admin e Auditor não são afetados.
const OPTIONS = [
  { key: 'none', label: 'Oculto', hint: 'Some do menu para quem é do departamento', tone: 'off' },
  { key: 'view', label: 'Só ver', hint: 'Mesmo que o cargo permita editar, só consulta', tone: 'view' },
  { key: 'edit', label: 'Conforme o cargo', hint: 'Vale o que o cargo da pessoa permite', tone: 'edit' },
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
      <p className={s.modalLead}>
        Vale para quem é deste departamento, por cima do cargo: o departamento só esconde ou restringe, nunca dá mais
        acesso do que o cargo já dá. Super Admin e Auditor sempre veem tudo.
      </p>
      <div className={s.matrixHead}>
        <h3 className={s.matrixTitle}>{hidden ? `${hidden} ${hidden === 1 ? 'área oculta' : 'áreas ocultas'}` : 'Todas as áreas conforme o cargo'}</h3>
        <div className={s.quick}>
          <span>Todas as áreas:</span>
          {OPTIONS.map(o => <button key={o.key} type="button" className={s.quickBtn} onClick={() => setAll(o.key)}>{o.label}</button>)}
        </div>
      </div>
      <ul className={s.permList} style={{ marginTop: 6 }}>
        {modules.map(m => (
          <li key={m.key} className={s.permRow}>
            <div className={s.permText}>
              <span className={s.modName}>{m.label}</span>
              <span className={s.modHint}>{m.hint}</span>
            </div>
            <LevelSwitch
              name={`dept-${m.key}`} label={m.label} options={OPTIONS}
              value={limits[m.key]} onChange={level => setLimits(l => ({ ...l, [m.key]: level }))}
            />
          </li>
        ))}
      </ul>
      {error && <p role="alert" className={`${s.msg} ${s.err}`}>{error}</p>}
      <div className={s.actions} style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  )
}
