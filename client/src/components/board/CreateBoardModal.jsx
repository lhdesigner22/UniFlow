import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import s from './CreateBoardModal.module.css'

const BOARD_COLORS = ['#3B82F6', '#22C55E', '#8B5CF6', '#FFB020', '#FF5C93', '#06B6D4', '#F97316', '#EF4444']

// Modal de criação de quadro, reaproveitado tanto pela Dashboard (grid de
// quadros) quanto pelo botão "+" da sidebar — mesmo formulário, mesmo POST
// /boards, só muda quem dispara e o que acontece depois (`onCreated`).
export default function CreateBoardModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', color: BOARD_COLORS[0] })
  const [creating, setCreating] = useState(false)

  const createBoard = async () => {
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const { data } = await api.post('/boards', form)
      onCreated?.(data)
    } catch {
      setCreating(false)
    }
  }

  return (
    <Modal title="Novo quadro" onClose={onClose} width={420}>
      <div className="form-group">
        <label className="label">Nome</label>
        <input
          autoFocus
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Ex: Marketing, Produto..."
          onKeyDown={e => e.key === 'Enter' && createBoard()}
        />
      </div>
      <div className="form-group">
        <label className="label">Descrição (opcional)</label>
        <textarea
          rows={2}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Sobre o que é este quadro?"
        />
      </div>
      <div className="form-group">
        <label className="label">Cor</label>
        <div className={s.colorSwatches}>
          {BOARD_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={s.swatch}
              style={{ background: c, outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
              onClick={() => setForm(f => ({ ...f, color: c }))}
            />
          ))}
        </div>
      </div>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || creating} onClick={createBoard}>
        {creating ? 'Criando...' : 'Criar quadro'}
      </button>
    </Modal>
  )
}
