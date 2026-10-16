import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import BoardPage from './pages/BoardPage'
import TeamTimePage from './pages/TeamTimePage'
import MetricsPage from './pages/MetricsPage'
import AgendaPage from './pages/AgendaPage'
import AdminPage from './pages/AdminPage'
import BacklogPage from './pages/BacklogPage'
import TotalChamadosPage from './pages/TotalChamadosPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import GestaoPage from './pages/GestaoPage'
import VaultPage from './pages/VaultPage'
import VlansPage from './pages/VlansPage'
import ApprovalsPage from './pages/ApprovalsPage'
import PurchaseRequestsPage from './pages/PurchaseRequestsPage'
import EquipmentLoansPage from './pages/EquipmentLoansPage'
import PrintersPage from './pages/PrintersPage'
import CompaniesPage from './pages/CompaniesPage'
import PartnersPage from './pages/PartnersPage'
import InternetLinksPage from './pages/InternetLinksPage'
import TeamPerformancePage from './pages/TeamPerformancePage'
import OrgChartPage from './pages/OrgChartPage'
import JourneyPage from './pages/JourneyPage'
import GoogleCallback from './pages/GoogleCallback'
import RequireModule from './components/common/RequireModule'

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
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/auth/google/callback" element={<GoogleCallback />} />
        <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="boards/:boardId" element={<RequireModule module="boards"><BoardPage /></RequireModule>} />
          <Route path="tempo" element={<RequireModule module="metrics"><TeamTimePage /></RequireModule>} />
          <Route path="metricas" element={<RequireModule module="metrics"><MetricsPage /></RequireModule>} />
          <Route path="agenda" element={<RequireModule module="agenda"><AgendaPage /></RequireModule>} />
          <Route path="backlog" element={<RequireModule module="tickets"><BacklogPage /></RequireModule>} />
          <Route path="chamados-total" element={<RequireModule module="tickets"><TotalChamadosPage /></RequireModule>} />
          <Route path="base-conhecimento" element={<RequireModule module="kb"><KnowledgeBasePage /></RequireModule>} />
          <Route path="gestao" element={<Navigate to="/gestao/documentos" replace />} />
          <Route path="gestao/documentos" element={<RequireModule module="gestao"><GestaoPage /></RequireModule>} />
          <Route path="gestao/cofre-senhas" element={<VaultPage />} />
          <Route path="gestao/vlans" element={<Navigate to="/gestao/vlans/matriz" replace />} />
          <Route path="gestao/vlans/:site" element={<VlansPage />} />
          <Route path="aprovacoes" element={<RequireModule module="approvals"><ApprovalsPage /></RequireModule>} />
          <Route path="solicitacoes-compra" element={<Navigate to="/solicitacoes-compra/todos" replace />} />
          <Route path="solicitacoes-compra/:month" element={<RequireModule module="purchases"><PurchaseRequestsPage /></RequireModule>} />
          <Route path="impressoras" element={<Navigate to="/impressoras/sede" replace />} />
          <Route path="impressoras/:location" element={<RequireModule module="printers"><PrintersPage /></RequireModule>} />
          <Route path="emprestimo-equipamentos" element={<Navigate to="/emprestimo-equipamentos/sede" replace />} />
          <Route path="emprestimo-equipamentos/:building" element={<RequireModule module="loans"><EquipmentLoansPage /></RequireModule>} />
          <Route path="empresas" element={<Navigate to="/empresas/colegio-ser" replace />} />
          <Route path="empresas/:company" element={<RequireModule module="companies"><CompaniesPage /></RequireModule>} />
          <Route path="link-internet" element={<RequireModule module="companies"><InternetLinksPage /></RequireModule>} />
          <Route path="parceiros" element={<RequireModule module="companies"><PartnersPage /></RequireModule>} />
          <Route path="time" element={<Navigate to="/time/desempenho" replace />} />
          <Route path="time/desempenho" element={<RequireModule module="team"><TeamPerformancePage /></RequireModule>} />
          <Route path="time/organograma" element={<RequireModule module="team"><OrgChartPage /></RequireModule>} />
          <Route path="time/jornada" element={<RequireModule module="team"><JourneyPage /></RequireModule>} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
