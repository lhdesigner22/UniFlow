import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useNotificationStore } from '../../store/notificationStore'
import { useAuthStore } from '../../store/authStore'
import { useTheme } from '../../hooks/useTheme'
import s from './Topbar.module.css'

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

export default function Topbar() {
  const [showNotifs, setShowNotifs] = useState(false)
  const [search, setSearch] = useState('')
  const { notifications, unread, fetch, markRead, markAllRead } = useNotificationStore()
  const { user } = useAuthStore()
  const { theme, toggle } = useTheme()
  const ref = useRef()
  const location = useLocation()

  useEffect(() => { fetch() }, [location.pathname])
  useEffect(() => {
    const timer = setInterval(fetch, 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setShowNotifs(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleThemeToggle = () => {
    document.documentElement.classList.add('theme-transition')
    toggle()
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 350)
  }

  return (
    <header className={s.topbar}>
      <div className={s.searchWrap}>
        <span className={s.searchIcon}><IconSearch /></span>
        <input
          className={s.search}
          placeholder="Buscar cards, pipes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={s.actions}>
        {/* Theme toggle */}
        <button
          className={`btn btn-icon ${s.themeBtn}`}
          onClick={handleThemeToggle}
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          <span className={s.themeIcon} data-active={theme === 'light'}>
            <IconSun />
          </span>
          <span className={s.themeIcon} data-active={theme === 'dark'}>
            <IconMoon />
          </span>
        </button>

        {/* Notifications */}
        <div ref={ref} className={s.notifWrap}>
          <button className={`btn btn-icon ${s.notifBtn}`} onClick={() => setShowNotifs(!showNotifs)}>
            <IconBell />
            {unread > 0 && <span className={s.badge}>{unread > 9 ? '9+' : unread}</span>}
          </button>

          {showNotifs && (
            <div className={s.notifPanel}>
              <div className={s.notifHeader}>
                <span>Notificações</span>
                {unread > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={markAllRead}>
                    Marcar todas lidas
                  </button>
                )}
              </div>
              <div className={s.notifList}>
                {notifications.length === 0 && (
                  <div className={s.empty}>
                    <span style={{ fontSize: 28, marginBottom: 8, display: 'block' }}>🔔</span>
                    Sem notificações por aqui
                  </div>
                )}
                {notifications.map(n => (
                  <div
                    key={n.id}
                    className={`${s.notifItem} ${!n.read ? s.unread : ''}`}
                    onClick={() => markRead(n.id)}
                  >
                    {!n.read && <span className={s.unreadDot} />}
                    <div className={s.notifBody}>
                      <div className={s.notifTitle}>{n.title}</div>
                      {n.content && <div className={s.notifContent}>{n.content}</div>}
                      <div className={s.notifTime}>
                        {new Date(n.created_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User avatar */}
        <div className={s.userAvatar} title={user?.name}>
          {user?.avatar
            ? <img src={user.avatar} alt={user.name} className={s.avatarImg} />
            : <span>{user?.name?.charAt(0).toUpperCase()}</span>
          }
        </div>
      </div>
    </header>
  )
}
