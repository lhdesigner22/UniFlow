import { useState, useEffect, useCallback } from 'react'
import s from './Modal.module.css'

export default function Modal({ title, onClose, children, width = 520 }) {
  const [closing, setClosing] = useState(false)

  const handleClose = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 160)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const handler = e => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handler)
    }
  }, [handleClose])

  return (
    <div
      className={`${s.overlay} ${closing ? s.overlayOut : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className={`${s.modal} ${closing ? s.modalOut : ''}`} style={{ width, maxWidth: '95vw' }}>
        <div className={s.header}>
          <h3 className={s.title}>{title}</h3>
          <button className="btn btn-icon" onClick={handleClose} style={{ fontSize:18, color:'var(--muted)' }}>✕</button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  )
}
