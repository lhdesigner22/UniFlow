import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import CreatePipeModal from '../components/pipe/CreatePipeModal'
import s from './DashboardPage.module.css'

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

  const totalCards  = pipes.reduce((s, p) => s + (p.cardCount || 0), 0)
  const adminCount  = pipes.filter(p => p.role === 'admin').length

  return (
    <div className={s.page}>

      {/* ── Header ── */}
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Painel de Controle</h1>
          <p className={s.pageSub}>
            Bem-vindo, <strong>{user?.name?.split(' ')[0]}</strong>
            {user?.department_name ? ` · ${user.department_name}` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Novo Pipe
        </button>
      </div>

      {/* ── Stats ── */}
      {!loading && pipes.length > 0 && (
        <div className={s.statsRow}>
          <div className={s.statItem}>
            <span className={s.statNumber}>{pipes.length}</span>
            <span className={s.statLabel}>Pipes ativos</span>
          </div>
          <div className={s.statDivider} />
          <div className={s.statItem}>
            <span className={s.statNumber}>{totalCards}</span>
            <span className={s.statLabel}>Cards em aberto</span>
          </div>
          <div className={s.statDivider} />
          <div className={s.statItem}>
            <span className={s.statNumber}>{adminCount}</span>
            <span className={s.statLabel}>Você administra</span>
          </div>
        </div>
      )}

      {/* ── Pipes section ── */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <h2 className={s.sectionTitle}>Pipes</h2>
          {!loading && pipes.length > 0 && (
            <span className={s.sectionCount}>{pipes.length}</span>
          )}
        </div>

        {loading ? (
          <div className={s.grid}>
            {[1,2,3,4].map(i => <div key={i} className={s.skeleton} />)}
          </div>
        ) : pipes.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </div>
            <h3>Nenhum pipe configurado</h3>
            <p>Crie seu primeiro pipe para começar a gerenciar aprovações e fluxos de trabalho.</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              Criar primeiro pipe
            </button>
          </div>
        ) : (
          <div className={s.grid}>
            {pipes.map(pipe => (
              <div key={pipe.id} className={s.card} onClick={() => navigate(`/pipe/${pipe.id}`)}>
                <div className={s.cardAccent} style={{ background: pipe.color }} />

                <div className={s.cardMain}>
                  <div className={s.cardTop}>
                    <div className={s.pipeIconWrap} style={{ color: pipe.color, background: pipe.color + '18' }}>
                      <span>{pipe.icon}</span>
                    </div>
                    <div className={s.cardMenu}>
                      <button title="Configurações"
                        onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/settings`) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                      </button>
                      <button title="Excluir" style={{ color:'var(--red)' }}
                        onClick={e => deletePipe(e, pipe.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <h3 className={s.pipeName}>{pipe.name}</h3>
                  {pipe.description && <p className={s.pipeDesc}>{pipe.description}</p>}
                </div>

                <div className={s.cardFooter}>
                  <div className={s.cardMeta}>
                    <span>{pipe.cardCount} card{pipe.cardCount !== 1 ? 's' : ''}</span>
                    <span className={s.metaDot} />
                    <span>{pipe.memberCount} membro{pipe.memberCount !== 1 ? 's' : ''}</span>
                    {pipe.role === 'admin' && <span className={s.adminBadge}>Admin</span>}
                  </div>
                  <div className={s.cardActions}>
                    <button onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/reports`) }}>
                      Relatórios
                    </button>
                    <button onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/automations`) }}>
                      Automações
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div className={s.addCard} onClick={() => setShowCreate(true)}>
              <div className={s.addIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <span>Novo Pipe</span>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreatePipeModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  )
}
