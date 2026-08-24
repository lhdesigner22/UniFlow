import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import AvatarStack from '../components/common/AvatarStack'
import Modal from '../components/common/Modal'
import { avatarColor } from '../utils/avatarColor'
import s from './DashboardPage.module.css'

const BOARD_COLORS = ['#FF6B4A', '#0EA5A5', '#845EF7', '#FFB020', '#22C55E', '#FF5C93', '#3B82F6', '#F97316']

function formatDue(due) {
  if (!due) return null
  const d = new Date(due)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [boards, setBoards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [myCards, setMyCards] = useState([])
  const [running, setRunning] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', color: BOARD_COLORS[0] })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get('/boards')
      .then(async r => {
        if (!alive) return
        const list = r.data || []
        setBoards(list)
        setLoading(false)

        // "Meus cartões": não existe endpoint dedicado no contrato da API —
        // busca os cards de cada quadro e filtra client-side. Só é razoável
        // porque cada usuário tende a ter poucos quadros; se isso mudar,
        // o ideal é criar um endpoint agregado no servidor.
        if (list.length > 0 && list.length <= 12) {
          try {
            const results = await Promise.all(
              list.map(b => api.get(`/boards/${b.id}/cards`).then(res => ({ board: b, cards: res.data || [] })).catch(() => ({ board: b, cards: [] })))
            )
            const mine = []
            for (const { board, cards } of results) {
              for (const c of cards) {
                if (c.members?.some(m => m.id === user?.id)) {
                  mine.push({ ...c, boardName: board.name, boardColor: board.color, boardId: board.id })
                }
              }
            }
            mine.sort((a, b) => {
              if (!a.due_date && !b.due_date) return 0
              if (!a.due_date) return 1
              if (!b.due_date) return -1
              return new Date(a.due_date) - new Date(b.due_date)
            })
            if (alive) setMyCards(mine.slice(0, 6))
          } catch { /* deviation-tolerant: skip silently */ }
        }
      })
      .catch(() => { if (alive) { setBoards([]); setLoading(false) } })

    api.get('/time/running').then(r => { if (alive) setRunning(r.data || null) }).catch(() => {})

    return () => { alive = false }
  }, [user?.id])

  const createBoard = async () => {
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const { data } = await api.post('/boards', form)
      setBoards(prev => [...(prev || []), data])
      setShowCreate(false)
      setForm({ name: '', description: '', color: BOARD_COLORS[0] })
      navigate(`/boards/${data.id}`)
    } catch {
      setCreating(false)
    }
  }

  const stopTimer = async () => {
    if (!running) return
    try {
      await api.post(`/cards/${running.card_id}/time/stop`)
      setRunning(null)
    } catch {}
  }

  const firstName = user?.name?.split(' ')[0] || ''

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Olá, {firstName}</h1>
          <p className={s.sub}>Aqui estão seus quadros e o que está em andamento agora.</p>
        </div>
      </div>

      {running && (
        <div className={s.runningBar}>
          <span className={s.runningDot} />
          <span>Você está com o cronômetro rodando em <strong>"{running.card_title}"</strong></span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/boards/${running.board_id}`)}>Ver quadro</button>
          <button className="btn btn-danger btn-sm" onClick={stopTimer}>Parar</button>
        </div>
      )}

      {/* ── Boards grid ── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>Meus quadros</h2>

        {loading ? (
          <div className={s.grid}>
            {[1, 2, 3].map(i => <div key={i} className={s.skeleton} />)}
          </div>
        ) : boards.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="18" rx="1"/>
                <rect x="14" y="3" width="7" height="10" rx="1"/>
              </svg>
            </div>
            <h3>Nenhum quadro ainda</h3>
            <p>Crie seu primeiro quadro para organizar tarefas em colunas e começar a registrar o tempo do time.</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Novo quadro</button>
          </div>
        ) : (
          <div className={s.grid}>
            {boards.map(b => (
              <div key={b.id} className={s.boardTile} onClick={() => navigate(`/boards/${b.id}`)}>
                <div className={s.boardAccent} style={{ background: b.color || avatarColor(b.id) }} />
                <div className={s.boardBody}>
                  <h3 className={s.boardName}>{b.name}</h3>
                  {b.description && <p className={s.boardDesc}>{b.description}</p>}
                  <div className={s.boardFooter}>
                    <AvatarStack members={b.members || []} max={5} size={24} />
                    <span className={s.boardMemberCount}>{b.member_count || b.members?.length || 0} membro{(b.member_count ?? b.members?.length) === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>
            ))}
            <button className={s.newBoardTile} onClick={() => setShowCreate(true)}>
              <span className={s.newBoardPlus}>+</span>
              <span>Novo quadro</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Meus cartões ── */}
      {!loading && myCards.length > 0 && (
        <div className={s.section}>
          <h2 className={s.sectionTitle}>Meus cartões</h2>
          <div className={s.cardsList}>
            {myCards.map(c => (
              <div key={c.id} className={s.cardRow} onClick={() => navigate(`/boards/${c.boardId}`)}>
                <span className={s.cardDot} style={{ background: c.boardColor || avatarColor(c.boardId) }} />
                <span className={s.cardTitle}>{c.title}</span>
                <span className={s.cardBoard}>{c.boardName}</span>
                {c.due_date && <span className={s.cardDue}>{formatDue(c.due_date)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <Modal title="Novo quadro" onClose={() => setShowCreate(false)} width={420}>
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
      )}
    </div>
  )
}
