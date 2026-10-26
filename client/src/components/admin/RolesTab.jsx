import { useState, useEffect } from 'react'
import api from '../../services/api'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import s from './RolesTab.module.css'

const LEVELS = [
  { key: 'none', label: 'Sem acesso', hint: 'Não vê a área nem no menu' },
  { key: 'view', label: 'Ver', hint: 'Consulta, mas não altera nada' },
  { key: 'edit', label: 'Editar', hint: 'Consulta e altera (criar, editar, apagar)' },
]

const emptyDraft = modules => ({
  name: '', description: '', scope: 'department',
  permissions: Object.fromEntries(modules.map(m => [m.key, 'none'])),
})

// Cargos (como os "perfis" do GLPI): por módulo, sem acesso / ver / editar, e se a
// pessoa enxerga todos os departamentos ou só o dela. Super Admin e Auditor são
// fixos (só leitura aqui).
export default function RolesTab({ roles, modules, setRoles, defaultRoleId, setDefaultRoleId }) {
  const [selectedId, setSelectedId] = useState(null) // id do cargo aberto | 'new'
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const selected = roles.find(r => r.id === selectedId) || null
  const isNew = selectedId === 'new'
  const locked = !!selected?.is_locked

  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles.find(r => r.id === 'role-colaborador')?.id || roles[0].id)
  }, [roles, selectedId])

  useEffect(() => {
    setMsg(null)
    if (isNew) setDraft(emptyDraft(modules))
    else if (selected) setDraft({ name: selected.name, description: selected.description || '', scope: selected.scope, permissions: { ...selected.permissions } })
  }, [selectedId, isNew, selected?.id, selected?.name, selected?.scope, JSON.stringify(selected?.permissions), selected?.description])

  if (!draft) return null

  const dirty = isNew || (selected && (
    draft.name !== selected.name || (draft.description || '') !== (selected.description || '') ||
    draft.scope !== selected.scope || modules.some(m => draft.permissions[m.key] !== selected.permissions[m.key])
  ))

  const setLevel = (key, level) => setDraft(d => ({ ...d, permissions: { ...d.permissions, [key]: level } }))
  const setAll = level => setDraft(d => ({ ...d, permissions: Object.fromEntries(modules.map(m => [m.key, level])) }))

  const save = async () => {
    if (!draft.name.trim()) { setMsg({ type: 'error', text: 'Dê um nome ao cargo.' }); return }
    setSaving(true)
    setMsg(null)
    try {
      if (isNew) {
        const { data } = await api.post('/admin/roles', draft)
        const created = { ...data, permissions: JSON.parse(data.permissions || '{}'), user_count: 0 }
        setRoles(prev => [...prev, created])
        setSelectedId(created.id)
      } else {
        const { data } = await api.put(`/admin/roles/${selected.id}`, draft)
        const parsed = JSON.parse(data.permissions || '{}')
        setRoles(prev => prev.map(r => r.id === selected.id ? { ...r, ...data, permissions: parsed } : r))
      }
      setMsg({ type: 'success', text: 'Cargo salvo. A mudança vale na hora para quem tem esse cargo.' })
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || 'Erro ao salvar o cargo.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const extra = selected.user_count > 0 ? ` As ${selected.user_count} pessoa(s) com esse cargo voltam para Colaborador.` : ''
    if (!(await confirmDialog(`Apagar o cargo "${selected.name}"?${extra}`, { title: 'Apagar cargo' }))) return
    try {
      await api.delete(`/admin/roles/${selected.id}`)
      setRoles(prev => prev.filter(r => r.id !== selected.id).map(r => r.id === 'role-colaborador' ? { ...r, user_count: r.user_count + selected.user_count } : r))
      setSelectedId('role-colaborador')
      if (selected.id === defaultRoleId) setDefaultRoleId('role-colaborador')
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao apagar.', { title: 'Erro', danger: true })
    }
  }

  const makeDefault = async () => {
    try {
      const { data } = await api.put('/admin/roles-default', { role_id: selected.id })
      setDefaultRoleId(data.defaultRoleId)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao definir o cargo padrão.', { title: 'Erro', danger: true })
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.info}>
        <strong>🔑 Como funciona:</strong> cada cargo define, para cada área do sistema, se a pessoa <em>não vê</em>, <em>só vê</em> ou <em>pode editar</em>. O <em>escopo</em> diz se ela enxerga o conteúdo de <em>todos os departamentos</em> ou só o <em>do seu</em> (mais o que for "Geral"). Quem entra pela primeira vez recebe o <em>cargo padrão</em> (marcado com 🚪).
      </div>

      <div className={s.roleList}>
        {roles.map(r => (
          <button key={r.id} type="button" className={`${s.roleChip} ${selectedId === r.id ? s.active : ''}`} onClick={() => setSelectedId(r.id)}>
            <span className={s.roleName}>{r.system_role === 'super_admin' ? '⭐ ' : r.system_role === 'auditor' ? '👁️ ' : ''}{r.name}{r.id === defaultRoleId && <span title="Cargo padrão de quem entra pela primeira vez"> 🚪</span>}</span>
            <span className={s.roleCount}>{r.user_count} {r.user_count === 1 ? 'pessoa' : 'pessoas'}</span>
          </button>
        ))}
        <button type="button" className={`${s.roleChip} ${s.newChip} ${isNew ? s.active : ''}`} onClick={() => setSelectedId('new')}>
          + Novo cargo
        </button>
      </div>

      <div className={s.editor}>
        {locked && (
          <p className={s.lockNote}>🔒 Este cargo é nativo e tem acesso fixo — aparece aqui só para consulta.</p>
        )}
        {!isNew && selected && !locked && (
          selected.id === defaultRoleId ? (
            <p className={s.defaultNote}>🚪 <strong>Cargo padrão:</strong> quem entra no UniFlow pela primeira vez recebe este cargo.</p>
          ) : (
            <p className={s.defaultNote}>
              Quem entra pela primeira vez hoje recebe <strong>{roles.find(r => r.id === defaultRoleId)?.name || 'Colaborador'}</strong>.{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={makeDefault}>🚪 Tornar este o cargo padrão</button>
            </p>
          )
        )}

        <div className={s.fields}>
          <label className={s.field}>
            <span>Nome do cargo</span>
            <input value={draft.name} disabled={locked} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ex: Recepção, Coordenador..." />
          </label>
          <label className={s.field}>
            <span>O que enxerga</span>
            <select value={draft.scope} disabled={locked} onChange={e => setDraft(d => ({ ...d, scope: e.target.value }))}>
              <option value="department">Só o conteúdo do próprio departamento</option>
              <option value="all">Conteúdo de todos os departamentos</option>
            </select>
          </label>
        </div>
        <label className={s.field}>
          <span>Descrição (opcional)</span>
          <input value={draft.description} disabled={locked} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Para quem é esse cargo" />
        </label>

        <div className={s.matrixHead}>
          <h3 className={s.matrixTitle}>Permissões por área</h3>
          {!locked && (
            <div className={s.quick}>
              <span>Marcar tudo:</span>
              {LEVELS.map(l => <button key={l.key} type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(l.key)}>{l.label}</button>)}
            </div>
          )}
        </div>

        <div className={s.matrixWrap}>
          <table className={s.matrix}>
            <thead>
              <tr>
                <th>Área</th>
                {LEVELS.map(l => <th key={l.key} title={l.hint}>{l.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {modules.map(m => (
                <tr key={m.key}>
                  <td>
                    <div className={s.modName}>{m.label}</div>
                    <div className={s.modHint}>{m.hint}</div>
                  </td>
                  {LEVELS.map(l => (
                    <td key={l.key} className={`${s.cell} ${draft.permissions[m.key] === l.key ? s[`on_${l.key}`] : ''}`}>
                      <input
                        type="radio" name={`perm-${m.key}`} style={{ width: 'auto' }}
                        checked={draft.permissions[m.key] === l.key} disabled={locked}
                        onChange={() => setLevel(m.key, l.key)}
                        aria-label={`${m.label}: ${l.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={s.footNote}>Cofre de Senhas e VLANs têm lista própria de acesso (Super Admin autoriza pessoa por pessoa). Administração é só do Super Admin.</p>

        {msg && <p className={`${s.msg} ${msg.type === 'success' ? s.ok : s.err}`}>{msg.text}</p>}

        {!locked && (
          <div className={s.actions}>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Salvando...' : isNew ? 'Criar cargo' : 'Salvar alterações'}
            </button>
            {!isNew && selected && selected.id !== 'role-colaborador' && (
              <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={remove}>🗑️ Apagar cargo</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
