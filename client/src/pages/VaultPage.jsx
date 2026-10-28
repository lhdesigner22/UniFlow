import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import MemberPicker from '../components/common/MemberPicker'
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
        <label className="label">Título</label>
        <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Wi-Fi SEDE, Painel admin GLPI..." />
      </div>
      <div className="form-group">
        <label className="label">Categoria</label>
        <input
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
        <label className="label">Usuário (opcional)</label>
        <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="Login/usuário, se houver" />
      </div>
      <div className="form-group">
        <label className="label">Senha{entry ? ' (deixe em branco pra manter a atual)' : ''}</label>
        <input type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={entry ? '••••••••' : 'Senha'} />
      </div>
      <div className="form-group">
        <label className="label">Link (opcional)</label>
        <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="Ex: link do painel administrativo" />
      </div>
      <div className="form-group">
        <label className="label">Observação (opcional)</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Contexto, onde fica o equipamento, etc." />
      </div>
      {error && <p className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.title.trim() || (!entry && !form.password) || saving}
        onClick={save}
      >
        {saving ? 'Salvando...' : 'Salvar'}
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
      <p className={s.hint} style={{ marginTop: 0, marginBottom: 12 }}>
        Super Admin sempre tem acesso. As pessoas listadas aqui são as autorizadas além disso.
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
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => revoke(row)}>Revogar</button>
            </div>
          ))}
          {list.length === 0 && <p className={s.hint}>Ninguém além dos Super Admins tem acesso ainda.</p>}
        </div>
      )}
      <div className={s.inviteWrap}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)}>+ Dar acesso a alguém</button>
        {showPicker && (
          <MemberPicker
            existingIds={(list || []).map(r => r.user_id)}
            onPick={grant}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
      {error && <p className={s.fileError}>{error}</p>}
    </Modal>
  )
}

function EntryCard({ entry, canManage, onEdit, onDelete }) {
  const [revealed, setRevealed] = useState(false)
  const [password, setPassword] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // A senha não fica guardada na tela: cada "Mostrar" e cada "Copiar" pede de
  // novo ao servidor, que registra no log de auditoria qual dos dois foi.
  // Mostrada, ela se esconde sozinha depois de 30 s.
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => { setRevealed(false); setPassword(null) }, 30000)
    return () => clearTimeout(t)
  }, [revealed])

  const fetchPassword = async (purpose) => {
    setLoading(true)
    try {
      const { data } = await api.get(`/vault/${entry.id}/reveal`, { params: { purpose } })
      return data.password
    } catch {
      await alertDialog('Erro ao revelar a senha. Tenta de novo?', { title: 'Erro', danger: true })
      return null
    } finally {
      setLoading(false)
    }
  }

  const toggleReveal = async () => {
    if (revealed) { setRevealed(false); setPassword(null); return }
    const pwd = await fetchPassword('show')
    if (pwd !== null) { setPassword(pwd); setRevealed(true) }
  }

  const copyPassword = async () => {
    const pwd = await fetchPassword('copy')
    if (pwd === null) return
    try {
      await navigator.clipboard.writeText(pwd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard indisponível — ignora silenciosamente */ }
  }

  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <h3 className={s.cardTitle}>{entry.title}</h3>
        {canManage && (
          <div className={s.cardActions}>
            <button className={s.iconBtn} title="Editar" onClick={() => onEdit(entry)}>✏️</button>
            <button className={s.iconBtn} title="Excluir" onClick={() => onDelete(entry)}>🗑️</button>
          </div>
        )}
      </div>
      {entry.category && <span className={s.badge}>{entry.category}</span>}
      {entry.username && (
        <div className={s.field}>
          <span className={s.fieldLabel}>Usuário</span>
          <span className={s.fieldValue}>{entry.username}</span>
        </div>
      )}
      <div className={s.field}>
        <span className={s.fieldLabel}>Senha</span>
        <div className={s.passwordRow}>
          <span className={s.passwordValue}>{loading ? '...' : revealed ? password : '••••••••'}</span>
          <button className={s.smallBtn} title={revealed ? 'Esconder' : 'Mostrar'} onClick={toggleReveal}>{revealed ? '🙈' : '👁'}</button>
          <button className={s.smallBtn} title="Copiar senha" onClick={copyPassword}>{copied ? '✓' : '📋'}</button>
        </div>
      </div>
      {entry.notes && <p className={s.notes}>{entry.notes}</p>}
      {entry.url && <a className={s.cardLink} href={safeHref(entry.url)} target="_blank" rel="noreferrer">🔗 Abrir link</a>}
      <div className={s.cardFooter}>
        <span className={s.cardMeta}>{entry.author_name || 'Alguém'} · {timeAgo(entry.updated_at)}</span>
      </div>
    </div>
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
          <h3>🔒 Sem acesso ao Cofre de Senhas</h3>
          <p>Só quem um Super Admin autorizar consegue ver esse conteúdo. Peça acesso a um Super Admin, se precisar.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Cofre de Senhas</h1>
          <p className={s.sub}>Senhas de wifi, painéis administrativos e outros acessos — visíveis só pra quem tem autorização.</p>
        </div>
        <div className={s.headerRight}>
          {user?.system_role === 'super_admin' && (
            <>
              <button className="btn btn-ghost" onClick={() => navigate('/admin?tab=logs&category=vault')}>🕵️ Histórico de acesso</button>
              <button className="btn btn-ghost" onClick={() => setShowAccess(true)}>🔑 Gerenciar acesso</button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo item</button>
        </div>
      </div>

      <div className={s.searchRow}>
        <input className={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título, usuário ou categoria..." />
        <span className={s.count}>{filtered.length} item(ns)</span>
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum item ainda</h3>
          <p>{(entries || []).length > 0 ? 'Nenhum item bate com esse filtro.' : 'Cadastre a primeira senha do cofre.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map(entry => (
            <EntryCard key={entry.id} entry={entry} canManage onEdit={setEditing} onDelete={deleteEntry} />
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
