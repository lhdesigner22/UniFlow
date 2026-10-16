import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../services/api'
import s from './MemberPicker.module.css'

/**
 * Popover de busca sobre o inventário de equipamentos de um prédio — mesmo
 * padrão do MemberPicker.jsx (busca com debounce, clique fora fecha).
 * `building`: filtra o GET /equipment-inventory; `onPick(item)` recebe o
 * item escolhido ({id, equipment_model, variant, patrimony, on_loan}).
 */
export default function InventoryPicker({ building, onPick, onClose, excludeIds = [] }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose?.() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    api.get('/equipment-inventory', { params: { building } })
      .then(r => setItems(r.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [building])

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    const available = items.filter(i => !excludeIds.includes(i.id)) // já escolhidos nesse mesmo empréstimo
    if (!term) return available
    return available.filter(i => `${i.equipment_model} ${i.variant || ''} ${i.patrimony || ''}`.toLowerCase().includes(term))
  }, [items, query, excludeIds])

  return (
    <div ref={wrapRef} className={s.panel} style={{ width: 300 }}>
      <input
        className={s.input}
        autoFocus
        placeholder="Buscar por modelo ou patrimônio..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className={s.list}>
        {loading && <div className={s.empty}>Carregando...</div>}
        {!loading && results.length === 0 && (
          <div className={s.empty}>{items.length === 0 ? 'Nenhum item cadastrado nesse prédio ainda.' : 'Nenhum item bate com a busca.'}</div>
        )}
        {!loading && results.map(i => (
          <button
            key={i.id}
            type="button"
            className={s.item}
            onClick={() => onPick(i)}
          >
            <span className={s.itemName}>{i.equipment_model}{i.variant ? ` — ${i.variant}` : ''} {i.patrimony ? `#${i.patrimony}` : ''}</span>
            {!!i.on_loan && <span className={s.itemEmail} style={{ color: 'var(--danger, #EF4444)' }}>emprestado</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
