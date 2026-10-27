import { useState } from 'react'
import api from '../../services/api'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import Modal from '../common/Modal'
import s from './MachineStandards.module.css'

// Base de Conhecimento → Padronização de máquinas: configuração mínima de
// computador por cargo e as exceções por setor (o setor vale para qualquer
// cargo dele). Quem edita a Base de Conhecimento atualiza pela tela.

const KINDS = [
  { key: 'cargo', label: 'Por cargo', hint: 'Configuração mínima conforme o cargo da pessoa.' },
  { key: 'setor', label: 'Por setor', hint: 'Estes setores seguem a própria regra, para qualquer cargo.' },
]
const ICONS = ['🎓', '👥', '👔', '💻', '🎬', '🖥️', '🎨', '📊', '🧑‍💻', '⚙️']
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
          <label className="label">Tipo</label>
          <select value={form.kind} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="label">{form.kind === 'setor' ? 'Setor' : 'Cargo'}</label>
          <input autoFocus value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder={form.kind === 'setor' ? 'Ex: Soluções Digitais' : 'Ex: Estagiário'} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Observação (opcional)</label>
        <input value={form.audience} maxLength={200} onChange={e => set('audience', e.target.value)} placeholder="Ex: Inclui coordenação, gerência e diretoria" />
      </div>
      <div className={s.formRow}>
        <div className="form-group">
          <label className="label">Processador</label>
          <input value={form.cpu} maxLength={80} onChange={e => set('cpu', e.target.value)} placeholder="Ex: Intel Core i5" />
        </div>
        <div className="form-group">
          <label className="label">Memória RAM</label>
          <input value={form.ram} maxLength={80} onChange={e => set('ram', e.target.value)} placeholder="Ex: 8 a 16 GB" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Requisito extra (opcional)</label>
        <input value={form.extra} maxLength={200} onChange={e => set('extra', e.target.value)} placeholder="Ex: Placa de vídeo dedicada" />
      </div>
      <div className="form-group">
        <label className="label">Ícone e cor</label>
        <div className={s.pickers}>
          {ICONS.map(i => (
            <button key={i} type="button" className={`${s.pick} ${form.icon === i ? s.pickOn : ''}`} onClick={() => set('icon', i)}>{i}</button>
          ))}
        </div>
        <div className={s.pickers} style={{ marginTop: 6 }}>
          {COLORS.map(c => (
            <button key={c} type="button" aria-label={`Cor ${c}`} className={`${s.swatch} ${form.color === c ? s.pickOn : ''}`} style={{ background: c }} onClick={() => set('color', c)} />
          ))}
        </div>
      </div>
      {error && <p className={s.error}>{error}</p>}
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
        <p><strong>Padronização de máquinas</strong> — configuração mínima do computador de cada colaborador. Vale o cargo da pessoa, exceto nos setores listados em “Por setor”, que seguem a própria regra.</p>
        {writable && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({})}>+ Novo perfil</button>}
      </div>

      {KINDS.map(k => {
        const list = items.filter(x => x.kind === k.key)
        if (!list.length) return null
        return (
          <section key={k.key} className={s.section}>
            <div className={s.sectionHead}>
              <h3>{k.label}</h3>
              <span>{k.hint}</span>
            </div>
            <div className={s.grid}>
              {list.map(m => (
                <div key={m.id} className={s.card}>
                  <div className={s.cardHead}>
                    <span className={s.icon} style={{ background: `${m.color || '#2D4FC4'}33`, boxShadow: `inset 0 0 0 2px ${m.color || '#2D4FC4'}` }}>{m.icon || '🖥️'}</span>
                    <div className={s.cardTitle}>
                      <h4>{m.name}</h4>
                      {m.audience && <span>{m.audience}</span>}
                    </div>
                    {writable && (
                      <div className={s.actions}>
                        <button title="Editar" onClick={() => setEditing(m)}>✏️</button>
                        <button title="Excluir" onClick={() => remove(m)}>🗑️</button>
                      </div>
                    )}
                  </div>
                  <dl className={s.specs}>
                    {m.cpu && <><dt>Processador</dt><dd>{m.cpu}</dd></>}
                    {m.ram && <><dt>Memória RAM</dt><dd>{m.ram}</dd></>}
                    {m.extra && <><dt>Extra</dt><dd>{m.extra}</dd></>}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )
      })}

      {items.length === 0 && (
        <div className={s.empty}>Nenhum perfil cadastrado ainda.</div>
      )}

      {editing && <Editor item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}
