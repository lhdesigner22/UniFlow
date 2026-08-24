import { create } from 'zustand'

// Substitui os `confirm()`/`alert()` nativos do navegador (feios, sem estilo,
// travam a thread) por um modal próprio do app. Uso: `await confirmDialog('...')`
// no lugar de `confirm('...')`, `await alertDialog('...')` no lugar de `alert('...')`.
// O estado mora aqui (zustand, mesmo padrão de notificationStore.js) e é
// renderizado uma única vez por <ConfirmDialogHost /> em AppLayout.jsx.
export const useDialogStore = create(() => ({
  open: false,
  type: 'confirm', // 'confirm' | 'alert'
  title: '',
  message: '',
  danger: false,
  confirmLabel: '',
  resolve: null,
}))

export function confirmDialog(message, { title = 'Confirmar ação', danger = true, confirmLabel = 'Confirmar' } = {}) {
  return new Promise(resolve => {
    useDialogStore.setState({ open: true, type: 'confirm', title, message, danger, confirmLabel, resolve })
  })
}

export function alertDialog(message, { title = 'Aviso', danger = false } = {}) {
  return new Promise(resolve => {
    useDialogStore.setState({ open: true, type: 'alert', title, message, danger, confirmLabel: 'OK', resolve })
  })
}
