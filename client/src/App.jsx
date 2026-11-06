import { useEffect, useState, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import GoogleCallback from './pages/GoogleCallback'
import RequireModule from './components/common/RequireModule'
import { isTeacherOnly } from './utils/permissions'
import { lazyPage } from './utils/lazyPage'

// Cada tela é baixada só quando abre (Login e Início vêm no pacote inicial)
const BoardPage = lazyPage(() => import('./pages/BoardPage'))
const TeamTimePage = lazyPage(() => import('./pages/TeamTimePage'))
const MetricsPage = lazyPage(() => import('./pages/MetricsPage'))
const AgendaPage = lazyPage(() => import('./pages/AgendaPage'))
const AdminPage = lazyPage(() => import('./pages/AdminPage'))
const BacklogPage = lazyPage(() => import('./pages/BacklogPage'))
const TotalChamadosPage = lazyPage(() => import('./pages/TotalChamadosPage'))
const KnowledgeBasePage = lazyPage(() => import('./pages/KnowledgeBasePage'))
const GestaoPage = lazyPage(() => import('./pages/GestaoPage'))
const DevelopmentsPage = lazyPage(() => import('./pages/DevelopmentsPage'))
const LabIncidentsPage = lazyPage(() => import('./pages/LabIncidentsPage'))
const SuccessCasesPage = lazyPage(() => import('./pages/SuccessCasesPage'))
const PrinterSuppliesPage = lazyPage(() => import('./pages/PrinterSuppliesPage'))
const VaultPage = lazyPage(() => import('./pages/VaultPage'))
const VlansPage = lazyPage(() => import('./pages/VlansPage'))
const ApprovalsPage = lazyPage(() => import('./pages/ApprovalsPage'))
const PurchaseRequestsPage = lazyPage(() => import('./pages/PurchaseRequestsPage'))
const EquipmentLoansPage = lazyPage(() => import('./pages/EquipmentLoansPage'))
const PrintersPage = lazyPage(() => import('./pages/PrintersPage'))
const CompaniesPage = lazyPage(() => import('./pages/CompaniesPage'))
const PartnersPage = lazyPage(() => import('./pages/PartnersPage'))
const InternetLinksPage = lazyPage(() => import('./pages/InternetLinksPage'))
const TeamPerformancePage = lazyPage(() => import('./pages/TeamPerformancePage'))
const OrgChartPage = lazyPage(() => import('./pages/OrgChartPage'))
const JourneyPage = lazyPage(() => import('./pages/JourneyPage'))
const ShiftSchedulePage = lazyPage(() => import('./pages/ShiftSchedulePage'))
const TeacherPortalPage = lazyPage(() => import('./pages/TeacherPortalPage'))
const ChromebookRequestsPage = lazyPage(() => import('./pages/ChromebookRequestsPage'))

function PrivateRoute({ children }) {
  const { user, token, loading } = useAuthStore()
  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--muted)' }}>Carregando...</div>
  if (!token || !user) return <Navigate to="/login" replace />
  return children
}

// Professor (cargo só do portal) não entra no app com menu: vai para /professor.
function MainLayout() {
  const { user } = useAuthStore()
  if (isTeacherOnly(user)) return <Navigate to="/professor" replace />
  return <AppLayout />
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

  // Disjuntor (services/circuitBreaker.js): a aba entrou em laço e parou de chamar a API.
  const [circuitOpen, setCircuitOpen] = useState(false)
  useEffect(() => {
    const handle = () => setCircuitOpen(true)
    window.addEventListener('app:circuit-open', handle)
    return () => window.removeEventListener('app:circuit-open', handle)
  }, [])

  return (
    <BrowserRouter>
      {circuitOpen && (
        <div role="alert" style={{ position: 'fixed', zIndex: 5000, left: 16, right: 16, bottom: 16, maxWidth: 560, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--surface)',
          border: '1px solid var(--danger)', color: 'var(--text)', boxShadow: 'var(--shadow-lg)', fontSize: 14 }}>
          <span style={{ flex: 1 }}>Esta aba parou de se comunicar com o servidor para não sobrecarregá-lo. Recarregue a página.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      )}
      <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/auth/google/callback" element={<GoogleCallback />} />
        <Route path="/professor" element={<PrivateRoute><TeacherPortalPage /></PrivateRoute>} />
        <Route path="/" element={<PrivateRoute><MainLayout /></PrivateRoute>}>
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
          <Route path="gestao/desenvolvimentos" element={<RequireModule module="gestao"><DevelopmentsPage /></RequireModule>} />
          <Route path="gestao/desenvolvimentos/:id" element={<RequireModule module="gestao"><DevelopmentsPage /></RequireModule>} />
          <Route path="gestao/cases-de-sucesso" element={<RequireModule module="gestao"><SuccessCasesPage /></RequireModule>} />
          <Route path="gestao/vlans" element={<Navigate to="/gestao/vlans/matriz" replace />} />
          <Route path="gestao/vlans/:site" element={<VlansPage />} />
          <Route path="aprovacoes" element={<RequireModule module="approvals"><ApprovalsPage /></RequireModule>} />
          <Route path="incidentes-laboratorios" element={<Navigate to="/incidentes-laboratorios/sede" replace />} />
          <Route path="incidentes-laboratorios/:building" element={<RequireModule module="incidents"><LabIncidentsPage /></RequireModule>} />
          <Route path="solicitacoes-compra" element={<Navigate to="/solicitacoes-compra/todos" replace />} />
          <Route path="solicitacoes-compra/:month" element={<RequireModule module="purchases"><PurchaseRequestsPage /></RequireModule>} />
          <Route path="impressoras" element={<Navigate to="/impressoras/sede" replace />} />
          <Route path="impressoras/:location" element={<RequireModule module="printers"><PrintersPage /></RequireModule>} />
          <Route path="estoque-insumos" element={<Navigate to="/estoque-insumos/sede" replace />} />
          <Route path="estoque-insumos/:location" element={<RequireModule module="printers"><PrinterSuppliesPage /></RequireModule>} />
          <Route path="emprestimo-equipamentos" element={<Navigate to="/emprestimo-equipamentos/sede" replace />} />
          <Route path="pedidos-chromebook" element={<RequireModule module="loans"><ChromebookRequestsPage /></RequireModule>} />
          <Route path="emprestimo-equipamentos/:building" element={<RequireModule module="loans"><EquipmentLoansPage /></RequireModule>} />
          <Route path="empresas" element={<Navigate to="/empresas/colegio-ser" replace />} />
          <Route path="empresas/:company" element={<RequireModule module="companies"><CompaniesPage /></RequireModule>} />
          <Route path="link-internet" element={<RequireModule module="companies"><InternetLinksPage /></RequireModule>} />
          <Route path="parceiros" element={<RequireModule module="companies"><PartnersPage /></RequireModule>} />
          <Route path="time" element={<Navigate to="/time/desempenho" replace />} />
          <Route path="time/desempenho" element={<RequireModule module="team"><TeamPerformancePage /></RequireModule>} />
          <Route path="time/organograma" element={<RequireModule module="team"><OrgChartPage /></RequireModule>} />
          <Route path="time/jornada" element={<RequireModule module="team"><JourneyPage /></RequireModule>} />
          <Route path="time/escala" element={<RequireModule module="team"><ShiftSchedulePage /></RequireModule>} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
