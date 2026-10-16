import { useState, useEffect, useRef } from 'react'
import api from '../../services/api'
import Avatar from './Avatar'
import s from './MemberPicker.module.css'

/**
 * Debounced typeahead over GET /users/search?q= — shared by the board
 * "+ Convidar" popover and the card "+ Adicionar" member popover.
 * `existingIds`: ids already members (shown disabled), `onPick(user)`.
 */
export default function MemberPicker({ existingIds = [], onPick, onClose, align = 'left' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose?.() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Busca também com o campo vazio (sem debounce nesse caso, já que abre
  // junto com o picker) — assim aparecem sugestões de quem ainda não foi
  // incluído antes mesmo da pessoa digitar. Com texto, mantém o debounce.
  useEffect(() => {
    setLoading(true)
    const fetchUsers = () => {
      api.get('/users/search', { params: { q: query.trim(), exclude: existingIds.join(',') } })
        .then(r => setResults(r.data || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }
    if (!query.trim()) { fetchUsers(); return }
    const t = setTimeout(fetchUsers, 300)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div ref={wrapRef} className={`${s.panel} ${align === 'right' ? s.panelRight : ''}`}>
      <input
        className={s.input}
        autoFocus
        placeholder="Buscar por nome ou e-mail..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className={s.list}>
        {loading && <div className={s.empty}>Buscando...</div>}
        {!loading && results.length === 0 && (
          <div className={s.empty}>{query.trim() ? 'Nenhum usuário encontrado.' : 'Ninguém disponível pra adicionar.'}</div>
        )}
        {!loading && results.map(u => {
          const already = existingIds.includes(u.id)
          return (
            <button
              key={u.id}
              type="button"
              className={s.item}
              disabled={already}
              onClick={() => !already && onPick(u)}
            >
              <Avatar id={u.id} name={u.name} photo={u.avatar} size={24} />
              <span className={s.itemName}>{u.name}</span>
              <span className={s.itemEmail}>{already ? 'já é membro' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
