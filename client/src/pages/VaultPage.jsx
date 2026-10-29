import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import MemberPicker from '../components/common/MemberPicker'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import SecretField from '../components/common/SecretField'
import s from './VaultPage.module.css'
import { safeHref } from '../utils/safeHref'

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `há ${days}d`
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')
}

function Editor({ entry, existingCategories, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: entry?.title || '',
    category: entry?.category || '',
    username: entry?.username || '',
    password: '',
    url: entry?.url || '',
    notes: entry?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!form.title.trim()) return
    if (!entry && !form.password) return
    setSaving(true)
    setError('')
    try {
      const saved = entry
        ? (await api.put(`/vault/${entry.id}`, form)).data
        : (await api.post('/vault', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={entry ? 'Editar item' : 'Novo item do cofre'} onClose={onClose} width={480}>
      <div className="form-group">
        <label htmlFor="vault-titulo" className="label">Título</label>
        <input id="vault-titulo" autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Wi-Fi SEDE, Painel admin GLPI..." />
      </div>
      <div className="form-group">
        <label htmlFor="vault-categoria" className="label">Categoria</label>
        <input id="vault-categoria"
          list="vault-category-list"
          value={form.category}
          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          placeholder="Ex: Wi-Fi, Admin, Impressora... (crie a que quiser)"
        />
        <datalist id="vault-category-list">
          {existingCategories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="form-group">
        <label htmlFor="vault-usuario-opcional" className="label">Usuário (opcional)</label>
        <input id="vault-usuario-opcional" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="Login/usuário, se houver" />
      </div>
      <div className="form-group">
        <label htmlFor="vault-senha" className="label">Senha{entry ? ' (deixe em branco pra manter a atual)' : ''}</label>
        <input id="vault-senha" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={entry ? '••••••••' : 'Senha'} />
      </div>
      <div className="form-group">
        <label htmlFor="vault-link-opcional" className="label">Link (opcional)</label>
        <input id="vault-link-opcional" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="Ex: link do painel administrativo" />
      </div>
      <div className="form-group">
        <label htmlFor="vault-observacao-opcional" className="label">Observação (opcional)</label>
        <textarea id="vault-observacao-opcional" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Contexto, onde fica o equipamento, etc." />
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.title.trim() || (!entry && !form.password) || saving}
        onClick={save}
      >
        {saving ? 'Salvando...' : entry ? 'Salvar alterações' : 'Guardar no cofre'}
      </button>
    </Modal>
  )
}

// "Quem tem acesso" — só Super Admin vê/gerencia esse modal.
function AccessModal({ onClose }) {
  const [list, setList] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    api.get('/vault/access/list')
      .then(r => setList(r.data || []))
      .catch(() => setList([]))
  }
  useEffect(() => { load() }, [])

  const grant = async u => {
    setShowPicker(false)
    setError('')
    try {
      const { data } = await api.post('/vault/access', { user_id: u.id })
      setList(prev => [...prev, data].sort((a, b) => a.user_name.localeCompare(b.user_name, 'pt-BR')))
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao conceder acesso.')
    }
  }

  const revoke = async row => {
    const ok = await confirmDialog(`Tirar o acesso de "${row.user_name}" ao cofre?`, { title: 'Revogar acesso' })
    if (!ok) return
    try {
      await api.delete(`/vault/access/${row.user_id}`)
      setList(prev => prev.filter(x => x.id !== row.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao revogar.', { title: 'Erro', danger: true })
    }
  }

  return (
    <Modal title="Quem tem acesso ao cofre" onClose={onClose} width={440}>
      <p className={s.modalLead}>
        Super Admin sempre tem acesso. As pessoas abaixo foram autorizadas além disso; cada senha que elas veem fica no histórico.
      </p>
      {list === null ? (
        <p className={s.hint}>Carregando...</p>
      ) : (
        <div className={s.accessList}>
          {list.map(row => (
            <div key={row.id} className={s.accessRow}>
              <div className={s.accessInfo}>
                <span className={s.accessName}>{row.user_name}</span>
                <span className={s.accessEmail}>{row.user_email}</span>
              </div>
              <button className={`btn btn-ghost btn-sm ${s.danger}`} onClick={() => revoke(row)}>Tirar acesso</button>
            </div>
          ))}
          {list.length === 0 && <p className={s.hint}>Ninguém além dos Super Admins tem acesso ainda.</p>}
        </div>
      )}
      <div className={s.inviteWrap}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)}><LineIcon name="user" size={14} /> Dar acesso a alguém</button>
        {showPicker && (
          <MemberPicker
            existingIds={(list || []).map(r => r.user_id)}
            onPick={grant}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
    </Modal>
  )
}

function EntryRow({ entry, onEdit, onDelete }) {
  const fetchSecret = async purpose => (await api.get(`/vault/${entry.id}/reveal`, { params: { purpose } })).data.password
  return (
    <li className={s.row}>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>{entry.title}</span>
        <span className={s.rowMeta}>
          {entry.username ? <>Usuário <span className={s.mono}>{entry.username}</span></> : 'Sem usuário'}
          {entry.notes && <span className={s.rowNotes} title={entry.notes}>{entry.notes}</span>}
        </span>
      </span>
      <SecretField fetchSecret={fetchSecret} />
      <span className={s.rowEnd}>
        {entry.url
          ? <a className={s.iconLink} href={safeHref(entry.url)} target="_blank" rel="noreferrer" aria-label={`Abrir o link de ${entry.title}`} title="Abrir link"><LineIcon name="link" size={15} /></a>
          : <span className={s.iconLink} aria-hidden="true" />}
        <span className={s.updated} title={`Atualizado por ${entry.author_name || 'alguém'}`}>{timeAgo(entry.updated_at)}</span>
        <RowMenu name={entry.title} items={[
          { label: 'Editar item', hint: 'A senha só muda se você digitar outra', icon: 'edit', onClick: () => onEdit(entry) },
          { label: 'Excluir item', icon: 'trash', danger: true, onClick: () => onDelete(entry) },
        ]} />
      </span>
    </li>
  )
}

export default function VaultPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [entries, setEntries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, item = editar
  const [showAccess, setShowAccess] = useState(false)

  useLiveRefresh(['vault'], () => load())
  const load = () => {
    api.get('/vault')
      .then(r => setEntries(r.data || []))
      .catch(e => {
        if (e.response?.status === 403) setDenied(true)
        setEntries([])
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return entries || []
    return (entries || []).filter(e =>
      e.title.toLowerCase().includes(term) ||
      (e.username || '').toLowerCase().includes(term) ||
      (e.category || '').toLowerCase().includes(term)
    )
  }, [entries, search])

  // grupos por categoria, em ordem alfabética ("Sem categoria" por último)
  const groups = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const k = e.category?.trim() || 'Sem categoria'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(e)
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === 'Sem categoria') - (b === 'Sem categoria') || a.localeCompare(b, 'pt-BR'))
      .map(([k, list]) => [k, list.sort((x, y) => x.title.localeCompare(y.title, 'pt-BR'))])
  }, [filtered])

  // Sugestões de categoria pro autocomplete do Editor — as já usadas +
  // algumas de partida, pra sempre ter algo pra escolher mesmo com o cofre vazio.
  const existingCategories = useMemo(() => {
    const set = new Set(['Wi-Fi', 'Admin', 'Outro'])
    for (const e of entries || []) if (e.category) set.add(e.category)
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [entries])

  const onSaved = entry => {
    setEntries(prev => {
      const exists = (prev || []).some(e => e.id === entry.id)
      return exists ? prev.map(e => e.id === entry.id ? entry : e) : [entry, ...(prev || [])]
    })
    setEditing(null)
  }

  const deleteEntry = async entry => {
    const ok = await confirmDialog(`Excluir "${entry.title}" do cofre?`, { title: 'Excluir item' })
    if (!ok) return
    try {
      await api.delete(`/vault/${entry.id}`)
      setEntries(prev => (prev || []).filter(e => e.id !== entry.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  if (loading) return <div className={s.loading}>Carregando cofre...</div>

  if (denied) {
    return (
      <div className={s.page}>
        <div className={s.denied}>
          <span className={s.deniedIcon}><LineIcon name="lock" size={22} /></span>
          <h1>Você não tem acesso ao Cofre de Senhas</h1>
          <p>Só quem um Super Admin autorizar consegue ver este conteúdo. Se precisar, peça o acesso a um Super Admin.</p>
        </div>
      </div>
    )
  }

  const total = (entries || []).length
  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Cofre de Senhas</h1>
          <p className={s.sub}>{total} {total === 1 ? 'acesso guardado' : 'acessos guardados'} com criptografia, visíveis só para quem tem autorização.</p>
        </div>
        <div className={s.headerRight}>
          {user?.system_role === 'super_admin' && (
            <>
              <button className="btn btn-ghost" onClick={() => navigate('/admin?tab=logs&category=vault')}><LineIcon name="clock" size={15} /> Histórico de acesso</button>
              <button className="btn btn-ghost" onClick={() => setShowAccess(true)}><LineIcon name="key" size={15} /> Quem tem acesso</button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo item</button>
        </div>
      </div>

      <p className={s.notice}>
        <LineIcon name="shield" size={15} />
        Cada senha mostrada ou copiada fica registrada no histórico, com o seu nome. Mostrada, ela se esconde sozinha em 30 segundos.
      </p>

      <div className={s.searchRow}>
        <label className={s.search}>
          <LineIcon name="search" size={15} />
          <span className="sr-only">Buscar no cofre</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título, usuário ou categoria" />
        </label>
        {search.trim() && <span className={s.count}>{filtered.length} de {total}</span>}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h2>{total > 0 ? `Nada com "${search.trim()}"` : 'O cofre está vazio'}</h2>
          <p>{total > 0 ? 'Tente o nome do sistema, o usuário ou a categoria.' : 'Guarde aqui a primeira senha: painel de equipamento, Wi-Fi, conta de serviço.'}</p>
        </div>
      ) : (
        <div className={s.groups}>
          {groups.map(([cat, list]) => (
            <section key={cat} className={s.group} aria-label={cat}>
              <h2 className={s.groupTitle}>{cat}<span className={s.groupCount}>{list.length}</span></h2>
              <ul className={s.list}>
                {list.map(entry => <EntryRow key={entry.id} entry={entry} onEdit={setEditing} onDelete={deleteEntry} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          entry={editing.id ? editing : null}
          existingCategories={existingCategories}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {showAccess && <AccessModal onClose={() => setShowAccess(false)} />}
    </div>
  )
}
