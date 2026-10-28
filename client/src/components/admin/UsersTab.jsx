import { useState, useMemo, useEffect, useRef } from 'react'
import { avatarColor } from '../../utils/avatarColor'
import { parseDbTimestamp } from '../../utils/formatDuration'
import LineIcon from '../common/LineIcon'
import s from './UsersTab.module.css'

// Admin → Usuários: quem está no sistema e com qual acesso (departamento = o
// conteúdo que a pessoa vê; cargo = o que ela pode fazer em cada área).
// Tabela com busca e filtros; as ações da pessoa ficam no menu "⋯" da linha.
const fmtSince = v => parseDbTimestamp(v)?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) || '—'
const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function UsersTab({ users, departments, roles, me, readOnly, onUpdate, onForceRelogin, onDelete }) {
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [menuFor, setMenuFor] = useState(null)

  const shown = useMemo(() => {
    const needle = norm(q.trim())
    return users.filter(u =>
      (!needle || norm(u.name).includes(needle) || norm(u.email).includes(needle)) &&
      (!roleFilter || u.role_id === roleFilter) &&
      (!deptFilter || (deptFilter === 'geral' ? !u.department_id : u.department_id === deptFilter))
    )
  }, [users, q, roleFilter, deptFilter])

  const filtered = q || roleFilter || deptFilter
  const clear = () => { setQ(''); setRoleFilter(''); setDeptFilter('') }

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.search}>
          <LineIcon name="search" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar pessoas" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filtrar por cargo">
          <option value="">Todos os cargos</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} aria-label="Filtrar por departamento">
          <option value="">Todos os departamentos</option>
          <option value="geral">Geral (sem departamento)</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Limpar</button>}
        <span className={s.count}>
          {filtered ? `${shown.length} de ${users.length} pessoas` : `${users.length} pessoas`}
        </span>
      </div>

      <div className={s.card}>
        <table className={s.table}>
          <caption className={s.caption}>
            O <strong>departamento</strong> define o conteúdo que a pessoa vê; o <strong>cargo</strong>, o que ela pode fazer em cada área (aba Cargos).
          </caption>
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col">Departamento</th>
              <th scope="col">Cargo</th>
              <th scope="col" className={s.num}>Entrou em</th>
              <th scope="col"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(u => {
              const isMe = u.id === me?.id
              const hue = avatarColor(u.id)
              return (
                <tr key={u.id}>
                  <td>
                    <div className={s.person}>
                      <span className={s.avatar} style={{ '--hue': hue }} aria-hidden="true">{u.name?.charAt(0)?.toUpperCase()}</span>
                      <span className={s.names}>
                        <span className={s.name}>{u.name}{isMe && <span className={s.me}>você</span>}</span>
                        <span className={s.email}>{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <select
                      className={s.cellSelect}
                      value={u.department_id || ''}
                      onChange={e => onUpdate(u.id, { department_id: e.target.value || null })}
                      disabled={readOnly}
                      aria-label={`Departamento de ${u.name}`}
                    >
                      <option value="">Geral (sem departamento)</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className={s.cellSelect}
                      value={u.role_id || 'role-colaborador'}
                      onChange={e => onUpdate(u.id, { role_id: e.target.value })}
                      disabled={readOnly || isMe}
                      title={isMe ? 'Você não pode alterar o próprio cargo' : undefined}
                      aria-label={`Cargo de ${u.name}`}
                    >
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className={`${s.num} ${s.since}`}>{fmtSince(u.created_at)}</td>
                  <td className={s.actions}>
                    {!readOnly && !isMe && (
                      <RowMenu
                        name={u.name}
                        open={menuFor === u.id}
                        onToggle={() => setMenuFor(m => (m === u.id ? null : u.id))}
                        onClose={() => setMenuFor(null)}
                        onForceRelogin={() => { setMenuFor(null); onForceRelogin(u) }}
                        onDelete={() => { setMenuFor(null); onDelete(u.id) }}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className={s.empty}>Ninguém com esses filtros. <button type="button" className={s.linkBtn} onClick={clear}>Limpar filtros</button></p>
        )}
      </div>
    </div>
  )
}

// Menu "⋯" da linha: abre com clique ou Enter, fecha com Esc, clique fora ou ao escolher.
function RowMenu({ name, open, onToggle, onClose, onForceRelogin, onDelete }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey = e => { if (e.key === 'Escape') { onClose(); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  return (
    <div className={s.menuWrap} ref={ref}>
      <button
        type="button"
        className={s.menuBtn}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ações de ${name}`}
        title="Ações"
      >
        <LineIcon name="more" size={18} />
      </button>
      {open && (
        <div className={s.menu} role="menu" aria-label={`Ações de ${name}`}>
          <button type="button" role="menuitem" onClick={onForceRelogin}>
            <LineIcon name="logout" />
            <span>
              Forçar novo login
              <small>Encerra a sessão; ela entra de novo com o Google</small>
            </span>
          </button>
          <button type="button" role="menuitem" className={s.danger} onClick={onDelete}>
            <LineIcon name="trash" />
            <span>Excluir usuário</span>
          </button>
        </div>
      )}
    </div>
  )
}
