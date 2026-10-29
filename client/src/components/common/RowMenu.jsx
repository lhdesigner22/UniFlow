import { useState, useEffect, useRef } from 'react'
import LineIcon from './LineIcon'
import s from './RowMenu.module.css'

// Menu "⋯" de uma linha de tabela (mesmo padrão da aba Usuários do Admin):
// abre com clique ou Enter, fecha com Esc, clique fora ou ao escolher.
// items: [{ label, hint?, icon?, onClick, danger?, disabled? }] — itens falsos são ignorados.
export default function RowMenu({ name, items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const list = items.filter(Boolean)
  if (!list.length) return null
  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.btn} onClick={() => setOpen(v => !v)}
        aria-haspopup="menu" aria-expanded={open} aria-label={`Mais ações de ${name}`} title="Mais ações">
        <LineIcon name="more" size={18} />
      </button>
      {open && (
        <div className={s.menu} role="menu" aria-label={`Ações de ${name}`}>
          {list.map(it => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
              className={it.danger ? s.danger : undefined}
              onClick={() => { setOpen(false); it.onClick() }}>
              {it.icon && <LineIcon name={it.icon} />}
              <span>{it.label}{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
