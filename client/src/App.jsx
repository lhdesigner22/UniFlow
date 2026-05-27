import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import BoardPage from './pages/BoardPage'
import PipeSettingsPage from './pages/PipeSettingsPage'
import AutomationsPage from './pages/AutomationsPage'
import ReportsPage from './pages/ReportsPage'
import PublicFormPage from './pages/PublicFormPage'
import AdminPage from './pages/AdminPage'
import GoogleCallback from './pages/GoogleCallback'

function PrivateRoute({ children }) {
  const { user, token, loading } = useAuthStore()
  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--muted)' }}>Carregando...</div>
  if (!token || !user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { fetchMe, token, logout } = useAuthStore()

  // Handle 401 from the axios interceptor (token expired mid-session).
  // Uses a custom event to avoid a circular import between api.js ↔ authStore.js.
  useEffect(() => {
    const handle = () => logout()
    window.addEventListener('app:unauthorized', handle)
    return () => window.removeEventListener('app:unauthorized', handle)
  }, [logout])

  useEffect(() => { if (token) fetchMe(); else useAuthStore.setState({ loading: false }) }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/google/callback" element={<GoogleCallback />} />
        <Route path="/forms/:token" element={<PublicFormPage />} />
        <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="pipe/:pipeId" element={<BoardPage />} />
          <Route path="pipe/:pipeId/settings" element={<PipeSettingsPage />} />
          <Route path="pipe/:pipeId/automations" element={<AutomationsPage />} />
          <Route path="pipe/:pipeId/reports" element={<ReportsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
