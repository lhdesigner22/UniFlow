import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
          <Outlet />
        </div>
      </div>
    </div>
  )
}
