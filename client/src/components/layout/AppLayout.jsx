import { useState, useEffect } from 'react'
import { startLive, stopLive } from '../../services/live'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import ConfirmDialogHost from '../common/ConfirmDialogHost'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Tempo real: abre a conexão enquanto a pessoa está logada e fecha ao sair
  // (este layout só existe dentro da área logada).
  useEffect(() => {
    startLive()
    return stopLive
  }, [])

  return (
    <div className={styles.layout}>
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      )}

      <div className={styles.main}>
        <Topbar onMenuClick={() => setSidebarOpen(o => !o)} />
        <div className={styles.content}>
          {/* key={pathname} remonta esse div a cada navegação, o que
              reinicia a animação de entrada — dá vida a toda troca de
              página sem precisar mexer em cada page.jsx individualmente. */}
          <div key={location.pathname} className={styles.pageTransition}>
            <Outlet />
          </div>
        </div>
      </div>

      <ConfirmDialogHost />
    </div>
  )
}
