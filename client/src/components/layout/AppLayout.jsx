import { useState, useEffect, useRef } from 'react'
import { startLive, stopLive } from '../../services/live'
import api from '../../services/api'
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

  // Log de auditoria: cada tela aberta (Admin → Logs). Só o caminho, sem a
  // ?busca; a mesma tela de novo em menos de 30 s não repete o registro.
  const lastView = useRef({ path: null, at: 0 })
  useEffect(() => {
    const path = location.pathname
    const now = Date.now()
    if (lastView.current.path === path && now - lastView.current.at < 30000) return
    lastView.current = { path, at: now }
    api.post('/audit/view', { path }).catch(() => {})
  }, [location.pathname])

  return (
    <div className={styles.layout}>
      {/* Primeiro item do Tab: pula o menu (~30 paradas) e vai direto ao conteúdo. */}
      <a
        href="#conteudo"
        className="skip-link"
        onClick={e => { e.preventDefault(); document.getElementById('conteudo')?.focus() }}
      >
        Pular para o conteúdo
      </a>
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      )}

      <div className={styles.main}>
        <Topbar onMenuClick={() => setSidebarOpen(o => !o)} />
        <main id="conteudo" className={styles.content} tabIndex={-1}>
          {/* key={pathname} remonta esse div a cada navegação, o que
              reinicia a animação de entrada — dá vida a toda troca de
              página sem precisar mexer em cada page.jsx individualmente. */}
          <div key={location.pathname} className={styles.pageTransition}>
            <Outlet />
          </div>
        </main>
      </div>

      <ConfirmDialogHost />
    </div>
  )
}
