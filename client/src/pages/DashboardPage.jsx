import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import CreatePipeModal from '../components/pipe/CreatePipeModal'
import s from './DashboardPage.module.css'

const ICONS = ['📋','🛒','💼','🔖','📊','🚀','🏗️','📝','💰','🎯','⚙️','🔔']
const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899']

export default function DashboardPage() {
  const [pipes, setPipes] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/pipes').then(r => { setPipes(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const handleCreate = (pipe) => { setPipes(prev => [pipe, ...prev]); navigate(`/pipe/${pipe.id}`) }
  const deletePipe = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Excluir este pipe e todos os dados?')) return
    await api.delete(`/pipes/${id}`)
    setPipes(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Olá, {user?.name?.split(' ')[0]} 👋</h1>
          <p className={s.sub}>Seus pipes de aprovação e gestão de fluxos</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Novo Pipe</button>
      </div>

      {loading ? (
        <div className={s.loadingGrid}>
          {[1,2,3].map(i => <div key={i} className={s.skeleton} />)}
        </div>
      ) : pipes.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📋</div>
          <h3>Nenhum pipe ainda</h3>
          <p>Crie seu primeiro pipe para começar a gerenciar aprovações e fluxos de trabalho</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Criar primeiro pipe</button>
        </div>
      ) : (
        <div className={s.grid}>
          {pipes.map(pipe => (
            <div key={pipe.id} className={s.card} onClick={() => navigate(`/pipe/${pipe.id}`)}>
              <div className={s.cardTop}>
                <div className={s.pipeIcon} style={{ background: pipe.color + '25', color: pipe.color }}>
                  {pipe.icon}
                </div>
                <div className={s.cardActions}>
                  <button className="btn btn-icon" onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/settings`) }}>⚙️</button>
                  <button className="btn btn-icon" onClick={e => deletePipe(e, pipe.id)} style={{ color:'var(--red)' }}>🗑️</button>
                </div>
              </div>
              <h3 className={s.pipeName}>{pipe.name}</h3>
              {pipe.description && <p className={s.pipeDesc}>{pipe.description}</p>}
              <div className={s.stats}>
                <span className="badge badge-blue">📄 {pipe.cardCount} cards</span>
                <span className="badge badge-gray">👥 {pipe.memberCount} membros</span>
                {pipe.role === 'admin' && <span className="badge badge-green">Admin</span>}
              </div>
              <div className={s.cardFooter}>
                <div className={s.pipeActions}>
                  <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/reports`) }}>📊 Relatórios</button>
                  <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/automations`) }}>⚡ Automações</button>
                </div>
              </div>
            </div>
          ))}
          <div className={s.addCard} onClick={() => setShowCreate(true)}>
            <span className={s.addIcon}>+</span>
            <span>Novo Pipe</span>
          </div>
        </div>
      )}

      {showCreate && <CreatePipeModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  )
}
