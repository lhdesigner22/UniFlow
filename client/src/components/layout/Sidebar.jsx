import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import CreatePipeModal from '../pipe/CreatePipeModal'
import s from './Sidebar.module.css'

export default function Sidebar() {
  const [pipes, setPipes] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/pipes').then(r => setPipes(r.data)).catch(() => {})
  }, [])

  const handleCreate = (pipe) => {
    setPipes(prev => [pipe, ...prev])
    navigate(`/pipe/${pipe.id}`)
  }

  return (
    <>
      <aside className={`${s.sidebar} ${collapsed ? s.collapsed : ''}`}>
        <div className={s.logo} onClick={() => navigate('/')}>
          <div className={s.logoIcon}>⚡</div>
          {!collapsed && <span>Uni<em>FLOW</em></span>}
        </div>

        <nav className={s.nav}>
          <NavLink to="/" end className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.icon}>🏠</span>
            {!collapsed && <span>Dashboard</span>}
          </NavLink>
          {user?.system_role === 'super_admin' && (
            <NavLink to="/admin" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
              <span className={s.icon}>⭐</span>
              {!collapsed && <span>Admin</span>}
            </NavLink>
          )}
        </nav>

        <div className={s.section}>
          {!collapsed && (
            <div className={s.sectionHeader}>
              <span>Pipes</span>
              <button className="btn btn-icon" onClick={() => setShowCreate(true)} title="Criar Pipe">+</button>
            </div>
          )}
          <div className={s.pipeList}>
            {pipes.map(pipe => (
              <NavLink key={pipe.id} to={`/pipe/${pipe.id}`} className={({ isActive }) => `${s.pipeItem} ${isActive ? s.active : ''}`}>
                <span className={s.pipeIcon} style={{ background: pipe.color + '30', color: pipe.color }}>{pipe.icon}</span>
                {!collapsed && <span className={s.pipeName}>{pipe.name}</span>}
              </NavLink>
            ))}
            {pipes.length === 0 && !collapsed && (
              <button className={s.createFirst} onClick={() => setShowCreate(true)}>
                + Criar primeiro pipe
              </button>
            )}
          </div>
        </div>

        <div className={s.footer}>
          <div className={s.userRow}>
            <div className="avatar" style={{ background: '#4a7cf7', fontSize: 11 }}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className={s.userInfo}>
                <span className={s.userName}>{user?.name}</span>
                <span className={s.userEmail}>{user?.email}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button className={`btn btn-ghost ${s.logoutBtn}`} onClick={logout}>Sair</button>
          )}
          <button className={`btn btn-icon ${s.collapseBtn}`} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '→' : '←'}
          </button>
        </div>
      </aside>

      {showCreate && <CreatePipeModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </>
  )
}
