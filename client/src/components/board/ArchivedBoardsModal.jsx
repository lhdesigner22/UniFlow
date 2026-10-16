import { useState, useEffect } from 'react'
import api from '../../services/api'
import { avatarColor } from '../../utils/avatarColor'
import Modal from '../common/Modal'
import s from './ArchivedBoardsModal.module.css'

const sortBoards = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))

// Lista de quadros arquivados + restaurar — antes vivia dentro da
// Início/DashboardPage.jsx (junto da grade "Meus quadros", que saiu de lá);
// virou modal próprio, acionado pelo mesmo botão "Quadros" da sidebar.
export default function ArchivedBoardsModal({ onClose, onRestored }) {
  const [boards, setBoards] = useState(null)

  useEffect(() => {
    api.get('/boards', { params: { archived: 1 } })
      .then(r => setBoards(sortBoards(r.data || [])))
      .catch(() => setBoards([]))
  }, [])

  const restore = async board => {
    try {
      await api.post(`/boards/${board.id}/unarchive`)
      setBoards(prev => (prev || []).filter(b => b.id !== board.id))
      onRestored?.({ ...board, archived: 0 })
    } catch { /* ignora — a lista continua consistente com o servidor no próximo fetch */ }
  }

  return (
    <Modal title="Quadros arquivados" onClose={onClose} width={420}>
      {boards === null ? (
        <p className={s.empty}>Carregando...</p>
      ) : boards.length === 0 ? (
        <p className={s.empty}>Nenhum quadro arquivado.</p>
      ) : (
        <div className={s.list}>
          {boards.map(b => (
            <div key={b.id} className={s.row}>
              <span className={s.dot} style={{ background: b.color || avatarColor(b.id) }} />
              <span className={s.name}>{b.name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => restore(b)}>↩ Restaurar</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
