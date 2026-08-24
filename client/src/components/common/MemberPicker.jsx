import { useState, useEffect, useRef } from 'react'
import api from '../../services/api'
import { avatarColor } from '../../utils/avatarColor'
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

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      api.get('/users/search', { params: { q: query.trim() } })
        .then(r => setResults(r.data || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
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
        {!loading && query.trim() && results.length === 0 && (
          <div className={s.empty}>Nenhum usuário encontrado.</div>
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
              <div className="avatar" style={{ width: 24, height: 24, fontSize: 10, background: avatarColor(u.id) }}>
                {u.name?.charAt(0).toUpperCase()}
              </div>
              <span className={s.itemName}>{u.name}</span>
              <span className={s.itemEmail}>{already ? 'já é membro' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
