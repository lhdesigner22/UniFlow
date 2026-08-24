import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import s from './Sidebar.module.css'

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
      <polyline points="9 21 9 12 15 12 15 21"/>
    </svg>
  )
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}

function IconTicket() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 1 1 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 1 1 0-4z"/>
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function IconChevron({ collapsed }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }}>
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

export default function Sidebar({ mobileOpen, onClose }) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  // Close mobile sidebar on route change
  useEffect(() => { onClose?.() }, [location.pathname])

  const initials = user?.name?.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase() || '?'

  // On mobile we always show labels regardless of desktop collapse state
  const showLabels = !collapsed || mobileOpen

  return (
      <aside className={`${s.sidebar} ${collapsed ? s.collapsed : ''} ${mobileOpen ? s.mobileOpen : ''}`}>

        {/* Logo */}
        <div className={s.logo} onClick={() => navigate('/')}>
          <div className={s.logoMark}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L16 6V14L10 18L4 14V6L10 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M10 6V10L13 12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          {showLabels && <span className={s.logoText}>Uni<em>FLOW</em></span>}
        </div>

        {/* Nav */}
        <nav className={s.nav}>
          <NavLink to="/" end className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconHome /></span>
            {showLabels && <span>Dashboard</span>}
          </NavLink>
          <NavLink to="/chamados" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconTicket /></span>
            {showLabels && <span>Chamados</span>}
          </NavLink>
          <NavLink to="/eventos" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconCalendar /></span>
            {showLabels && <span>Eventos</span>}
          </NavLink>
          {user?.system_role === 'super_admin' && (
            <NavLink to="/admin" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
              <span className={s.navIcon}><IconShield /></span>
              {showLabels && <span>Administração</span>}
            </NavLink>
          )}
        </nav>

        {/* Footer */}
        <div className={s.footer}>
          {showLabels && (
            <div className={s.userInfo}>
              <div className={s.userAvatar}>{initials}</div>
              <div className={s.userMeta}>
                <span className={s.userName}>{user?.name}</span>
                <span className={s.userEmail}>{user?.email}</span>
              </div>
            </div>
          )}
          <div className={s.footerActions}>
            {showLabels && (
              <button className={`btn btn-ghost ${s.logoutBtn}`} onClick={logout}>Sair</button>
            )}
            <button className={`btn btn-icon ${s.collapseBtn}`} onClick={() => setCollapsed(!collapsed)}>
              <IconChevron collapsed={collapsed} />
            </button>
          </div>
        </div>
      </aside>
  )
}
