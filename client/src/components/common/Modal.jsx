import { useState, useEffect, useCallback, useId, useRef } from 'react'
import s from './Modal.module.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ title, onClose, children, width = 520 }) {
  const [closing, setClosing] = useState(false)
  const dialogRef = useRef(null)
  const titleId = useId()
  // Lido na 1ª renderização: antes do autoFocus de algum campo do modal tirar o foco do botão que abriu.
  const [opener] = useState(() => document.activeElement)

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

  // Acessibilidade do teclado: ao abrir, o foco entra no modal (se a tela já
  // não pôs autoFocus num campo); o Tab fica preso dentro dele; ao fechar, o
  // foco volta para o botão que abriu. Com modal sobre modal, só o de cima prende.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = [...dialog.querySelectorAll(FOCUSABLE)].find(el => !el.closest(`.${s.header}`))
      ;(first || dialog).focus()
    }
    const trap = e => {
      if (e.key !== 'Tab' || !dialog) return
      const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (open[open.length - 1] !== dialog) return
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      // Só no fechamento de verdade (o modal já saiu da página); o StrictMode
      // do modo dev desmonta e remonta sem tirar o modal da tela.
      if (dialog?.isConnected) return
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [opener])

  return (
    <div
      className={`${s.overlay} ${closing ? s.overlayOut : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        ref={dialogRef}
        className={`${s.modal} ${closing ? s.modalOut : ''}`}
        style={{ width, maxWidth: '95vw' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={s.header}>
          <h3 className={s.title} id={titleId}>{title}</h3>
          <button className="btn btn-icon" onClick={handleClose} style={{ fontSize:18, color:'var(--muted)' }} aria-label="Fechar">✕</button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  )
}
