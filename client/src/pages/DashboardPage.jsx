import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import CreatePipeModal from '../components/pipe/CreatePipeModal'
import s from './DashboardPage.module.css'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

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

  const totalCards   = pipes.reduce((s, p) => s + (p.cardCount || 0), 0)
  const adminPipes   = pipes.filter(p => p.role === 'admin').length
  const firstName    = user?.name?.split(' ')[0] || 'Usuário'

  const stats = [
    { label: 'Pipes ativos',   value: pipes.length, icon: '⬡',  color: '#4a7cf7' },
    { label: 'Cards no total', value: totalCards,   icon: '▣',  color: '#22c55e' },
    { label: 'Você é admin',   value: `${adminPipes} pipe${adminPipes !== 1 ? 's' : ''}`, icon: '◈', color: '#8b5cf6' },
  ]

  return (
    <div className={s.page}>

      {/* ── Hero ── */}
      <div className={s.hero}>
        <div className={s.heroText}>
          <h1 className={s.heroTitle}>{getGreeting()}, {firstName} 👋</h1>
          <p className={s.heroSub}>Gerencie seus fluxos de aprovação e acompanhe o progresso dos times</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <span style={{ fontSize:16, lineHeight:1 }}>+</span> Novo Pipe
        </button>
      </div>

      {/* ── Stats ── */}
      {!loading && pipes.length > 0 && (
        <div className={s.stats}>
          {stats.map(stat => (
            <div key={stat.label} className={s.statCard}>
              <div className={s.statIcon} style={{ color: stat.color, background: stat.color + '18' }}>
                {stat.icon}
              </div>
              <div>
                <div className={s.statValue}>{stat.value}</div>
                <div className={s.statLabel}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Grid ── */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <h2 className={s.sectionTitle}>Seus Pipes</h2>
          {!loading && pipes.length > 0 && (
            <span className={s.sectionCount}>{pipes.length} pipe{pipes.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className={s.grid}>
            {[1,2,3,4].map(i => <div key={i} className={s.skeleton} />)}
          </div>
        ) : pipes.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIllustration}>
              <div className={s.emptyIconBg}>📋</div>
            </div>
            <h3>Nenhum pipe ainda</h3>
            <p>Crie seu primeiro pipe para começar a gerenciar aprovações e fluxos de trabalho</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Criar primeiro pipe
            </button>
          </div>
        ) : (
          <div className={s.grid}>
            {pipes.map(pipe => (
              <div key={pipe.id} className={s.card} onClick={() => navigate(`/pipe/${pipe.id}`)}>
                {/* Color bar */}
                <div className={s.cardBar} style={{ background: pipe.color }} />

                <div className={s.cardHeader}>
                  <div className={s.pipeIconWrap} style={{ background: pipe.color + '20', borderColor: pipe.color + '40' }}>
                    <span style={{ fontSize: 22 }}>{pipe.icon}</span>
                  </div>
                  <div className={s.cardActions}>
                    <button className="btn btn-icon" title="Configurações"
                      onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/settings`) }}>⚙️</button>
                    <button className="btn btn-icon" title="Excluir pipe"
                      onClick={e => deletePipe(e, pipe.id)} style={{ color:'var(--red)' }}>🗑️</button>
                  </div>
                </div>

                <div className={s.cardBody}>
                  <h3 className={s.pipeName}>{pipe.name}</h3>
                  {pipe.description && <p className={s.pipeDesc}>{pipe.description}</p>}
                </div>

                <div className={s.cardFooter}>
                  <div className={s.cardStats}>
                    <span className={s.stat}>
                      <span className={s.statDot} style={{ background: pipe.color }} />
                      {pipe.cardCount} cards
                    </span>
                    <span className={s.stat}>
                      👥 {pipe.memberCount}
                    </span>
                    {pipe.role === 'admin' && <span className="badge badge-purple" style={{ fontSize:10, padding:'2px 7px' }}>Admin</span>}
                  </div>
                  <div className={s.cardLinks}>
                    <button className={s.cardLink}
                      onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/reports`) }}>
                      📊 Relatórios
                    </button>
                    <button className={s.cardLink}
                      onClick={e => { e.stopPropagation(); navigate(`/pipe/${pipe.id}/automations`) }}>
                      ⚡ Automações
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add pipe card */}
            <div className={s.addCard} onClick={() => setShowCreate(true)}>
              <div className={s.addIconCircle}>
                <span>+</span>
              </div>
              <span className={s.addLabel}>Criar novo pipe</span>
              <span className={s.addSub}>Configure fases, campos e automações</span>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreatePipeModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  )
}
