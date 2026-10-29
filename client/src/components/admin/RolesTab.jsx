import { useState, useEffect } from 'react'
import api from '../../services/api'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import LineIcon from '../common/LineIcon'
import LevelSwitch from './LevelSwitch'
import s from './RolesTab.module.css'

const LEVELS = [
  { key: 'none', label: 'Sem acesso', hint: 'Não vê a área nem no menu', tone: 'off' },
  { key: 'view', label: 'Ver', hint: 'Consulta, mas não altera nada', tone: 'view' },
  { key: 'edit', label: 'Editar', hint: 'Consulta e altera (criar, editar, apagar)', tone: 'edit' },
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

  // a mensagem ("Cargo salvo") só some ao trocar de cargo — não quando o próprio salvar atualiza o cargo
  useEffect(() => { setMsg(null) }, [selectedId])

  useEffect(() => {
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

  const defaultName = roles.find(r => r.id === defaultRoleId)?.name || 'Colaborador'
  const counts = Object.fromEntries(LEVELS.map(l => [l.key, modules.filter(m => draft.permissions[m.key] === l.key).length]))

  return (
    <div className={s.wrap}>
      <p className={s.lead}>
        Cada cargo diz o que a pessoa vê ou edita em cada área, e se ela enxerga todos os departamentos ou só o dela.
        Quem entra pela primeira vez recebe o cargo padrão: hoje, <strong>{defaultName}</strong>.
      </p>

      <div className={s.layout}>
        <nav className={s.roleList} aria-label="Cargos">
          {roles.map(r => (
            <button key={r.id} type="button" aria-current={selectedId === r.id ? 'true' : undefined}
              className={`${s.roleItem} ${selectedId === r.id ? s.active : ''}`} onClick={() => setSelectedId(r.id)}>
              <span className={s.roleName}>
                {r.name}
                {!!r.is_locked && <LineIcon name="lock" size={13} className={s.roleLock} title="Cargo nativo, acesso fixo" />}
              </span>
              <span className={s.roleMeta}>
                {r.user_count} {r.user_count === 1 ? 'pessoa' : 'pessoas'}
                {r.id === defaultRoleId && <span className={s.tag}>Padrão</span>}
              </span>
            </button>
          ))}
          <button type="button" aria-current={isNew ? 'true' : undefined}
            className={`${s.roleItem} ${s.newItem} ${isNew ? s.active : ''}`} onClick={() => setSelectedId('new')}>
            <LineIcon name="plus" size={14} /> Novo cargo
          </button>
        </nav>

        <section className={s.editor} aria-label={isNew ? 'Novo cargo' : `Cargo ${selected?.name || ''}`}>
          <header className={s.editorHead}>
            <div>
              <h2 className={s.editorTitle}>{isNew ? 'Novo cargo' : selected?.name}</h2>
              <p className={s.editorSub}>
                {locked
                  ? 'Cargo nativo: o acesso é fixo e aparece aqui só para consulta.'
                  : isNew ? 'Comece sem acesso a nada e libere área por área.'
                  : selected?.id === defaultRoleId ? 'Cargo padrão: quem entra no UniFlow pela primeira vez recebe este.'
                  : `${counts.edit} ${counts.edit === 1 ? 'área' : 'áreas'} com edição, ${counts.view} só para ver, ${counts.none} sem acesso.`}
              </p>
            </div>
            {!isNew && selected && !locked && selected.id !== defaultRoleId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={makeDefault}>Tornar cargo padrão</button>
            )}
          </header>

          <div className={s.fields}>
            <div className={s.field}>
              <label htmlFor="role-name">Nome do cargo</label>
              <input id="role-name" value={draft.name} disabled={locked} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ex: Recepção, Coordenador..." />
            </div>
            <div className={s.field}>
              <label htmlFor="role-scope">O que enxerga</label>
              <select id="role-scope" value={draft.scope} disabled={locked} onChange={e => setDraft(d => ({ ...d, scope: e.target.value }))}>
                <option value="department">Só o conteúdo do próprio departamento</option>
                <option value="all">Conteúdo de todos os departamentos</option>
              </select>
            </div>
            <div className={`${s.field} ${s.wide}`}>
              <label htmlFor="role-desc">Descrição <span className={s.optional}>(opcional)</span></label>
              <input id="role-desc" value={draft.description} disabled={locked} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Para quem é esse cargo" />
            </div>
          </div>

          <div className={s.matrixHead}>
            <h3 className={s.matrixTitle}>Permissões por área</h3>
            {!locked && (
              <div className={s.quick}>
                <span>Todas as áreas:</span>
                {LEVELS.map(l => <button key={l.key} type="button" className={s.quickBtn} onClick={() => setAll(l.key)}>{l.label}</button>)}
              </div>
            )}
          </div>

          <ul className={s.permList}>
            {modules.map(m => (
              <li key={m.key} className={s.permRow}>
                <div className={s.permText}>
                  <span className={s.modName}>{m.label}</span>
                  <span className={s.modHint}>{m.hint}</span>
                </div>
                <LevelSwitch
                  name={`perm-${m.key}`} label={m.label} options={LEVELS}
                  value={draft.permissions[m.key]} disabled={locked} onChange={level => setLevel(m.key, level)}
                />
              </li>
            ))}
          </ul>
          <p className={s.footNote}>Cofre de Senhas e VLANs têm lista própria de acesso (o Super Admin libera pessoa por pessoa). Administração é só do Super Admin.</p>

          {msg && <p role={msg.type === 'success' ? 'status' : 'alert'} className={`${s.msg} ${msg.type === 'success' ? s.ok : s.err}`}>{msg.text}</p>}

          {!locked && (
            <div className={s.actions}>
              <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
                {saving ? 'Salvando...' : isNew ? 'Criar cargo' : 'Salvar alterações'}
              </button>
              {!isNew && selected && selected.id !== 'role-colaborador' && (
                <button className={`btn btn-ghost ${s.danger}`} onClick={remove}><LineIcon name="trash" size={14} /> Apagar cargo</button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
