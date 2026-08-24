import { useDialogStore } from '../../store/dialogStore'
import Modal from './Modal'

// Renderizado uma vez em AppLayout.jsx — mostra o modal de confirm()/alert()
// sempre que confirmDialog()/alertDialog() (store/dialogStore.js) forem chamados.
export default function ConfirmDialogHost() {
  const { open, type, title, message, danger, confirmLabel, resolve } = useDialogStore()
  if (!open) return null

  const close = (result) => {
    useDialogStore.setState({ open: false, resolve: null })
    resolve?.(result)
  }

  return (
    <Modal title={title} onClose={() => close(false)} width={420}>
      <p style={{ color: 'var(--muted)', marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {message}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {type === 'confirm' && (
          <button className="btn btn-ghost btn-sm" onClick={() => close(false)}>Cancelar</button>
        )}
        <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
