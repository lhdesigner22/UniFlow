import { useEffect } from 'react'
import s from './Modal.module.css'

export default function Modal({ title, onClose, children, width = 520 }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal} style={{ width, maxWidth: '95vw' }}>
        <div className={s.header}>
          <h3 className={s.title}>{title}</h3>
          <button className="btn btn-icon" onClick={onClose} style={{ fontSize:18, color:'var(--muted)' }}>✕</button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  )
}
