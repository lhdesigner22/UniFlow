import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useNotificationStore } from '../../store/notificationStore'
import { useAuthStore } from '../../store/authStore'
import s from './Topbar.module.css'

export default function Topbar() {
  const [showNotifs, setShowNotifs] = useState(false)
  const [search, setSearch] = useState('')
  const { notifications, unread, fetch, markRead, markAllRead } = useNotificationStore()
  const { user } = useAuthStore()
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

  return (
    <header className={s.topbar}>
      <div className={s.searchWrap}>
        <span className={s.searchIcon}>🔍</span>
        <input
          className={s.search}
          placeholder="Buscar cards, pipes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={s.actions}>
        <div ref={ref} className={s.notifWrap}>
          <button className={`btn btn-icon ${s.notifBtn}`} onClick={() => setShowNotifs(!showNotifs)}>
            🔔
            {unread > 0 && <span className={s.badge}>{unread}</span>}
          </button>
          {showNotifs && (
            <div className={s.notifPanel}>
              <div className={s.notifHeader}>
                <span>Notificações</span>
                {unread > 0 && <button className="btn btn-sm btn-ghost" onClick={markAllRead}>Marcar todas lidas</button>}
              </div>
              <div className={s.notifList}>
                {notifications.length === 0 && <div className={s.empty}>Sem notificações</div>}
                {notifications.map(n => (
                  <div key={n.id} className={`${s.notifItem} ${!n.read ? s.unread : ''}`} onClick={() => markRead(n.id)}>
                    <div className={s.notifTitle}>{n.title}</div>
                    {n.content && <div className={s.notifContent}>{n.content}</div>}
                    <div className={s.notifTime}>{new Date(n.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="avatar" style={{ background: '#4a7cf7', fontSize: 11, cursor: 'pointer' }}>
          {user?.name?.charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  )
}
