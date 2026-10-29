import { useState } from 'react'
import api from '../../services/api'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import Modal from '../common/Modal'
import LineIcon from '../common/LineIcon'
import s from './MachineStandards.module.css'

// Base de Conhecimento → Padronização de máquinas: configuração mínima de
// computador por cargo e as exceções por setor (o setor vale para qualquer
// cargo dele). Quem edita a Base de Conhecimento atualiza pela tela.

const KINDS = [
  { key: 'cargo', label: 'Por cargo', hint: 'Configuração mínima conforme o cargo da pessoa.' },
  { key: 'setor', label: 'Por setor', hint: 'Estes setores seguem a própria regra, para qualquer cargo.' },
]
const COLORS = ['#7ED957', '#F5C518', '#2D4FC4', '#00B0D4', '#FF2D5E', '#8B5CF6', '#F97316', '#64748B']

function Editor({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind: item?.kind || 'cargo',
    name: item?.name || '',
    audience: item?.audience || '',
    cpu: item?.cpu || '',
    ram: item?.ram || '',
    extra: item?.extra || '',
    icon: item?.icon || '🖥️',
    color: item?.color || '#2D4FC4',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = item
        ? (await api.put(`/machine-standards/${item.id}`, form)).data
        : (await api.post('/machine-standards', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? 'Editar perfil' : 'Novo perfil'} onClose={onClose} width={560}>
      <div className={s.formRow}>
        <div className="form-group">
          <label htmlFor="machine-standards-tipo" className="label">Tipo</label>
          <select id="machine-standards-tipo" value={form.kind} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 2 }}>
          <label htmlFor="machine-standards-campo" className="label">{form.kind === 'setor' ? 'Setor' : 'Cargo'}</label>
          <input id="machine-standards-campo" autoFocus value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder={form.kind === 'setor' ? 'Ex: Soluções Digitais' : 'Ex: Estagiário'} />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="machine-standards-observacao-opcional" className="label">Observação (opcional)</label>
        <input id="machine-standards-observacao-opcional" value={form.audience} maxLength={200} onChange={e => set('audience', e.target.value)} placeholder="Ex: Inclui coordenação, gerência e diretoria" />
      </div>
      <div className={s.formRow}>
        <div className="form-group">
          <label htmlFor="machine-standards-processador" className="label">Processador</label>
          <input id="machine-standards-processador" value={form.cpu} maxLength={80} onChange={e => set('cpu', e.target.value)} placeholder="Ex: Intel Core i5" />
        </div>
        <div className="form-group">
          <label htmlFor="machine-standards-memoria-ram" className="label">Memória RAM</label>
          <input id="machine-standards-memoria-ram" value={form.ram} maxLength={80} onChange={e => set('ram', e.target.value)} placeholder="Ex: 8 a 16 GB" />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="machine-standards-requisito-extra-opcional" className="label">Requisito extra (opcional)</label>
        <input id="machine-standards-requisito-extra-opcional" value={form.extra} maxLength={200} onChange={e => set('extra', e.target.value)} placeholder="Ex: Placa de vídeo dedicada" />
      </div>
      <div className="form-group">
        <span className="label" id="machine-standards-cor">Cor</span>
        <div className={s.pickers} role="radiogroup" aria-labelledby="machine-standards-cor">
          {COLORS.map(c => (
            <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={`Cor ${c}`} className={`${s.swatch} ${form.color === c ? s.pickOn : ''}`} style={{ background: c }} onClick={() => set('color', c)} />
          ))}
        </div>
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function MachineStandards({ items, setItems, writable }) {
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, item = editar

  const onSaved = saved => {
    setItems(prev => prev.some(x => x.id === saved.id) ? prev.map(x => x.id === saved.id ? saved : x) : [...prev, saved])
    setEditing(null)
  }

  const remove = async item => {
    if (!(await confirmDialog(`Excluir o perfil "${item.name}" da padronização?`, { title: 'Excluir perfil' }))) return
    try {
      await api.delete(`/machine-standards/${item.id}`)
      setItems(prev => prev.filter(x => x.id !== item.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.intro}>
        <p>
          Configuração mínima do computador de cada pessoa. Vale o cargo, exceto nos setores da segunda tabela,
          que seguem a própria regra para qualquer cargo.
        </p>
        {writable && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({})}><LineIcon name="plus" size={14} /> Novo perfil</button>}
      </div>

      {KINDS.map(k => {
        const list = items.filter(x => x.kind === k.key)
        if (!list.length) return null
        return (
          <section key={k.key} className={s.card} aria-labelledby={`ms-${k.key}`}>
            <table className={s.table}>
              <caption id={`ms-${k.key}`} className={s.caption}>
                <strong>{k.label}</strong> <span>{k.hint}</span>
              </caption>
              <thead>
                <tr>
                  <th>{k.key === 'setor' ? 'Setor' : 'Cargo'}</th>
                  <th>Processador</th>
                  <th>Memória RAM</th>
                  <th>Requisito extra</th>
                  {writable && <th className={s.actionsCol}><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {list.map(m => (
                  <tr key={m.id}>
                    <td>
                      <span className={s.profile}>
                        <span className={s.dot} style={{ background: m.color || '#2D4FC4' }} aria-hidden="true" />
                        <span>
                          <span className={s.name}>{m.name}</span>
                          {m.audience && <span className={s.audience}>{m.audience}</span>}
                        </span>
                      </span>
                    </td>
                    <td className={s.spec}>{m.cpu || <span className={s.none}>—</span>}</td>
                    <td className={s.spec}>{m.ram || <span className={s.none}>—</span>}</td>
                    <td className={s.spec}>{m.extra || <span className={s.none}>Nenhum</span>}</td>
                    {writable && (
                      <td className={s.actionsCol}>
                        <span className={s.actions}>
                          <button type="button" onClick={() => setEditing(m)} aria-label={`Editar ${m.name}`} title="Editar"><LineIcon name="edit" size={15} /></button>
                          <button type="button" className={s.danger} onClick={() => remove(m)} aria-label={`Excluir ${m.name}`} title="Excluir"><LineIcon name="trash" size={15} /></button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}

      {items.length === 0 && (
        <div className={s.empty}>Nenhum perfil ainda. {writable ? 'Crie o primeiro com "Novo perfil".' : ''}</div>
      )}

      {editing && <Editor item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}
