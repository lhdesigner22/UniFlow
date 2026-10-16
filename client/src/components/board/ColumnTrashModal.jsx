import { useState, useEffect } from 'react'
import api from '../../services/api'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import Modal from '../common/Modal'
import s from './ColumnTrashModal.module.css'

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.round(hours / 24)}d`
}

// Lixeira de colunas excluídas do quadro — DELETE /:id agora é soft delete
// (ver server/src/routes/columns.js), então toda coluna apagada passa por
// aqui antes de sumir de vez.
export default function ColumnTrashModal({ boardId, onClose, onChanged }) {
  const [columns, setColumns] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    api.get(`/boards/${boardId}/columns/trash`)
      .then(r => setColumns(r.data || []))
      .catch(() => setColumns([]))
  }
  useEffect(() => { load() }, [boardId])

  const restore = async col => {
    setBusyId(col.id)
    try {
      await api.post(`/boards/${boardId}/columns/${col.id}/restore`)
      setColumns(prev => prev.filter(c => c.id !== col.id))
      onChanged()
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao restaurar a coluna.', { title: 'Erro', danger: true })
    } finally {
      setBusyId(null)
    }
  }

  const deleteForever = async col => {
    const ok = await confirmDialog(
      `Excluir "${col.name}" definitivamente? ${col.card_count > 0 ? `Os ${col.card_count} cartão(ões) dela também serão apagados. ` : ''}Isso não pode ser desfeito.`,
      { title: 'Excluir de vez' }
    )
    if (!ok) return
    setBusyId(col.id)
    try {
      await api.delete(`/boards/${boardId}/columns/${col.id}/permanent`)
      setColumns(prev => prev.filter(c => c.id !== col.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir a coluna.', { title: 'Erro', danger: true })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal title="Lixeira de colunas" onClose={onClose} width={480}>
      {columns === null ? (
        <p className={s.empty}>Carregando...</p>
      ) : columns.length === 0 ? (
        <p className={s.empty}>Nenhuma coluna excluída no momento.</p>
      ) : (
        <div className={s.list}>
          {columns.map(col => (
            <div key={col.id} className={s.row}>
              <div className={s.info}>
                <span className={s.name}>{col.name}</span>
                <span className={s.meta}>
                  {col.card_count} cartão{col.card_count === 1 ? '' : 's'} · excluída {timeAgo(col.deleted_at)}
                </span>
              </div>
              <div className={s.actions}>
                <button className="btn btn-ghost btn-sm" disabled={busyId === col.id} onClick={() => restore(col)}>
                  ↺ Restaurar
                </button>
                <button className={`btn btn-ghost btn-sm ${s.dangerBtn}`} disabled={busyId === col.id} onClick={() => deleteForever(col)}>
                  🗑️ Excluir de vez
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
