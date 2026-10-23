import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import api from '../../services/api'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { canView } from '../../utils/permissions'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import { currentMonth, monthLabel } from '../../utils/months'
import CreateBoardModal from '../board/CreateBoardModal'
import ArchivedBoardsModal from '../board/ArchivedBoardsModal'
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

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 7 12 12 16 14"/>
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
    </svg>
  )
}

function IconBacklog() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="7" y1="8" x2="17" y2="8"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
      <line x1="7" y1="16" x2="13" y2="16"/>
    </svg>
  )
}

function IconBook() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )
}

function IconBriefcase() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
    </svg>
  )
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="20" x2="20" y2="20"/>
      <rect x="6" y="13" width="3" height="7"/>
      <rect x="11" y="9" width="3" height="11"/>
      <rect x="16" y="5" width="3" height="15"/>
    </svg>
  )
}

function IconTeam() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2"/>
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
      <circle cx="17.5" cy="9" r="2.4"/>
      <path d="M15.5 14.3c2.4.3 4.5 2.4 4.5 5.2"/>
    </svg>
  )
}

function IconApprovals() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M8 12.5l2.5 2.5L16 9"/>
    </svg>
  )
}

function IconCart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.4"/>
      <circle cx="18" cy="20" r="1.4"/>
      <path d="M2.5 3h2.4l2.2 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21.5 7H6"/>
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="12" height="20" rx="1"/>
      <path d="M16 22V9l4 2v11"/>
      <line x1="8" y1="6" x2="8" y2="6.01"/>
      <line x1="12" y1="6" x2="12" y2="6.01"/>
      <line x1="8" y1="10" x2="8" y2="10.01"/>
      <line x1="12" y1="10" x2="12" y2="10.01"/>
      <line x1="8" y1="14" x2="8" y2="14.01"/>
      <line x1="12" y1="14" x2="12" y2="14.01"/>
    </svg>
  )
}

function IconPrinter() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>
  )
}

function IconSwap() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" />
    </svg>
  )
}

function IconDots() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8"/>
      <circle cx="12" cy="12" r="1.8"/>
      <circle cx="12" cy="19" r="1.8"/>
    </svg>
  )
}

function IconArchive() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="5" rx="1"/>
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/>
      <line x1="10" y1="13" x2="14" y2="13"/>
    </svg>
  )
}

function IconChevronSmall({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>
      <polyline points="9 6 15 12 9 18"/>
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
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

const CHAMADOS_PATHS = ['/backlog', '/chamados-total']
const PRINTERS_PATHS = ['/impressoras/sede', '/impressoras/adm', '/impressoras/centro', '/impressoras/g5', '/impressoras/clinicas']
const EQUIPMENT_LOANS_PATHS = ['/emprestimo-equipamentos/sede', '/emprestimo-equipamentos/centro', '/emprestimo-equipamentos/g5']
const COMPANIES_PATHS = ['/empresas/colegio-ser', '/empresas/unifecaf', '/link-internet', '/parceiros']
const TEAM_PATHS = ['/time/desempenho', '/time/organograma', '/time/jornada']
const FLOWS_PATHS = ['/aprovacoes']
const GESTAO_PATHS = ['/gestao/documentos', '/gestao/cofre-senhas']
const VISIBLE_BOARDS_LIMIT = 6

export default function Sidebar({ mobileOpen, onClose }) {
  const [collapsed, setCollapsed] = useState(false)
  const [boards, setBoards] = useState([])
  const [printersCount, setPrintersCount] = useState(null)
  const [companiesCount, setCompaniesCount] = useState(null)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(null)
  const [pendingPurchaseCount, setPendingPurchaseCount] = useState(null)
  const [purchaseMonths, setPurchaseMonths] = useState([])
  const [showCreateBoard, setShowCreateBoard] = useState(false)
  const [showArchivedBoards, setShowArchivedBoards] = useState(false)
  const [boardsExpanded, setBoardsExpanded] = useState(false)
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  const menuRef = useRef(null)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const chamadosActive = CHAMADOS_PATHS.includes(location.pathname)
  const [chamadosOpen, setChamadosOpen] = useState(chamadosActive)
  const suppliesActive = location.pathname.startsWith('/estoque-insumos')
  const printersActive = PRINTERS_PATHS.includes(location.pathname) || suppliesActive
  const [printersOpen, setPrintersOpen] = useState(printersActive)
  const equipmentLoansActive = EQUIPMENT_LOANS_PATHS.includes(location.pathname)
  const [equipmentLoansOpen, setEquipmentLoansOpen] = useState(equipmentLoansActive)
  const companiesActive = COMPANIES_PATHS.includes(location.pathname)
  const [companiesOpen, setCompaniesOpen] = useState(companiesActive)
  const teamActive = TEAM_PATHS.includes(location.pathname)
  const [teamOpen, setTeamOpen] = useState(teamActive)
  const purchaseActive = location.pathname.startsWith('/solicitacoes-compra')
  const [purchaseMonthsOpen, setPurchaseMonthsOpen] = useState(purchaseActive)
  const incidentsActive = location.pathname.startsWith('/incidentes-laboratorios')
  const [incidentsOpen, setIncidentsOpen] = useState(incidentsActive)
  const flowsActive = FLOWS_PATHS.includes(location.pathname) || purchaseActive || incidentsActive
  const [flowsOpen, setFlowsOpen] = useState(flowsActive)
  const vlansActive = location.pathname.startsWith('/gestao/vlans')
  const [vlansOpen, setVlansOpen] = useState(vlansActive)
  const devsActive = location.pathname.startsWith('/gestao/desenvolvimentos')
  const [devsOpen, setDevsOpen] = useState(devsActive)
  const gestaoActive = GESTAO_PATHS.includes(location.pathname) || vlansActive || devsActive
  const [gestaoOpen, setGestaoOpen] = useState(gestaoActive)
  const boardsActive = location.pathname.startsWith('/boards/')
  const [boardsListOpen, setBoardsListOpen] = useState(boardsActive)

  // Mantém o grupo aberto sempre que a rota atual for uma das sub-páginas
  useEffect(() => { if (chamadosActive) setChamadosOpen(true) }, [location.pathname])
  useEffect(() => { if (printersActive) setPrintersOpen(true) }, [location.pathname])
  useEffect(() => { if (equipmentLoansActive) setEquipmentLoansOpen(true) }, [location.pathname])
  useEffect(() => { if (companiesActive) setCompaniesOpen(true) }, [location.pathname])
  useEffect(() => { if (teamActive) setTeamOpen(true) }, [location.pathname])
  useEffect(() => { if (flowsActive) setFlowsOpen(true) }, [location.pathname])
  useEffect(() => { if (purchaseActive) setPurchaseMonthsOpen(true) }, [location.pathname])
  useEffect(() => { if (incidentsActive) setIncidentsOpen(true) }, [location.pathname])
  useEffect(() => { if (gestaoActive) setGestaoOpen(true) }, [location.pathname])
  useEffect(() => { if (vlansActive) setVlansOpen(true) }, [location.pathname])
  useEffect(() => { if (devsActive) setDevsOpen(true) }, [location.pathname])
  useEffect(() => { if (boardsActive) setBoardsListOpen(true) }, [location.pathname])

  // Se o quadro aberto agora estiver "escondido" atrás do corte de
  // VISIBLE_BOARDS_LIMIT (ex: veio de um link direto ou da busca), expande a
  // lista pra ele continuar visível/destacado — mesmo espírito de manter os
  // outros grupos abertos na rota ativa.
  useEffect(() => {
    const activeBoardId = location.pathname.match(/^\/boards\/([^/]+)/)?.[1]
    if (!activeBoardId) return
    const idx = boards.findIndex(b => b.id === activeBoardId)
    if (idx >= VISIBLE_BOARDS_LIMIT) setBoardsExpanded(true)
  }, [location.pathname, boards])

  // Close mobile sidebar on route change
  useEffect(() => { onClose?.() }, [location.pathname])

  // Tempo real: quando OUTRO aparelho mexe num desses recursos, o número
  // correspondente aqui no menu é buscado de novo (o contador sobe/desce sem
  // precisar navegar). Cada recurso tem seu próprio "tick" que entra nas
  // dependências do efeito abaixo.
  const [liveTick, setLiveTick] = useState({ boards: 0, printers: 0, companies: 0, approvals: 0, purchase: 0, developments: 0, incidents: 0, supplies: 0 })
  const bump = key => setLiveTick(t => ({ ...t, [key]: t[key] + 1 }))
  // Mexer em cartão/coluna de um quadro não muda a lista de quadros do menu.
  useLiveRefresh(['boards'], msg => { if (!msg?.s) bump('boards') })
  useLiveRefresh(['printers'], () => bump('printers'))
  useLiveRefresh(['companies'], () => bump('companies'))
  useLiveRefresh(['approvals'], () => bump('approvals'))
  useLiveRefresh(['purchase-requests'], () => bump('purchase'))
  useLiveRefresh(['developments'], () => bump('developments'))
  useLiveRefresh(['lab-incidents'], () => bump('incidents'))
  useLiveRefresh(['printer-supplies'], () => bump('supplies'))

  // Impressoras → Estoque de insumos: itens no mínimo ou abaixo (todos os prédios).
  // Só ao abrir e quando o estoque muda (não a cada navegação — economiza leitura).
  const [suppliesLow, setSuppliesLow] = useState(0)
  useEffect(() => {
    if (!canView(user, 'printers')) return
    api.get('/printer-supplies/low').then(r => setSuppliesLow(Object.values(r.data || {}).reduce((a, n) => a + n, 0))).catch(() => {})
  }, [user?.id, liveTick.supplies])

  // Fluxos → Incidentes Laboratórios: em aberto (aberto + em andamento) por prédio.
  const [incidentCounts, setIncidentCounts] = useState({})
  useEffect(() => {
    if (!canView(user, 'incidents')) return
    api.get('/lab-incidents/counts').then(r => setIncidentCounts(r.data || {})).catch(() => {})
  }, [user?.id, location.pathname, liveTick.incidents])
  const incidentsTotal = Object.values(incidentCounts).reduce((a, n) => a + n, 0)

  // Gestão → Desenvolvimentos: só os nomes (sem as logos) pra listar no menu.
  const [developments, setDevelopments] = useState([])
  useEffect(() => {
    if (!canView(user, 'gestao')) return
    api.get('/developments', { params: { menu: 1 } })
      .then(r => setDevelopments(r.data || []))
      .catch(() => {})
  }, [user?.id, liveTick.developments])

  useEffect(() => {
    api.get('/boards')
      .then(r => setBoards((r.data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))))
      .catch(() => {})
  }, [location.pathname, liveTick.boards])

  // Total de impressoras cadastradas (todos os locais) — só pro numerozinho
  // ao lado do menu; refaz ao navegar pra refletir cadastros/remoções recentes.
  useEffect(() => {
    api.get('/printers')
      .then(r => setPrintersCount((r.data || []).length))
      .catch(() => {})
  }, [location.pathname, liveTick.printers])

  // Total de filiais cadastradas (as duas empresas somadas) — mesmo
  // espírito do contador de impressoras acima.
  useEffect(() => {
    api.get('/companies')
      .then(r => setCompaniesCount((r.data || []).length))
      .catch(() => {})
  }, [location.pathname, liveTick.companies])

  // Quantas aprovações estão esperando MINHA decisão — badge ao lado do
  // menu, mesmo espírito do contador de não lidas nas notificações.
  useEffect(() => {
    api.get('/approvals', { params: { scope: 'received' } })
      .then(r => setPendingApprovalsCount((r.data || []).filter(a => a.my_decision === 'pending').length))
      .catch(() => {})
  }, [location.pathname, liveTick.approvals])

  // Quantas Solicitações de Compra esperam MINHA decisão como aprovador —
  // mesmo espírito do contador de Aprovações acima (my_decision). Também
  // reaproveita a mesma resposta pra montar a cascata de meses do menu
  // (todo mês que já tem solicitação + o mês atual, mais recente primeiro).
  useEffect(() => {
    api.get('/purchase-requests')
      .then(r => {
        const rows = r.data || []
        setPendingPurchaseCount(rows.filter(p => p.my_decision === 'pending').length)
        const months = new Set(rows.map(p => p.reference_month).filter(Boolean))
        months.add(currentMonth())
        setPurchaseMonths([...months].sort().reverse().map(ym => ({ key: ym, label: monthLabel(ym) })))
      })
      .catch(() => {})
  }, [location.pathname, liveTick.purchase])

  // Fecha o menu de "..." de um quadro ao clicar fora dele
  useEffect(() => {
    if (!menuOpenFor) return
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpenFor(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenFor])

  const archiveBoard = async board => {
    setMenuOpenFor(null)
    const ok = await confirmDialog(
      `Arquivar o quadro "${board.name}"? Ele sai da lista, mas nada é apagado — dá pra restaurar depois na Início, em "Quadros arquivados".`,
      { title: 'Arquivar quadro' }
    )
    if (!ok) return
    try {
      await api.post(`/boards/${board.id}/archive`)
      setBoards(prev => prev.filter(b => b.id !== board.id))
      if (location.pathname === `/boards/${board.id}`) navigate('/')
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao arquivar o quadro.', { title: 'Erro', danger: true })
    }
  }

  // Menus só pro que o cargo da pessoa permite (a regra de verdade é do servidor)
  const can = module => canView(user, module)

  const initials = user?.name?.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase() || '?'

  // On mobile we always show labels regardless of desktop collapse state
  const showLabels = !collapsed || mobileOpen

  return (
    <>
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
            {showLabels && <span>Início</span>}
          </NavLink>
          {can('agenda') && (
          <>
          <NavLink to="/agenda" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconCalendar /></span>
            {showLabels && <span>Agenda</span>}
          </NavLink>
          </>
          )}
          {can('metrics') && (
          <>
          <NavLink to="/metricas" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconChart /></span>
            {showLabels && <span>Métricas</span>}
          </NavLink>
          </>
          )}
          {can('team') && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${teamActive ? s.active : ''}`}
            onClick={() => showLabels ? setTeamOpen(o => !o) : navigate('/time/desempenho')}
          >
            <span className={s.navIcon}><IconTeam /></span>
            {showLabels && (
              <>
                <span>Time</span>
                <span className={`${s.navGroupChevron} ${teamOpen ? s.open : ''}`}><IconChevronSmall open={teamOpen} /></span>
              </>
            )}
          </button>
          {showLabels && teamOpen && (
            <div className={s.navSubList}>
              <NavLink to="/time/desempenho" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Desempenho</span>
              </NavLink>
              <NavLink to="/time/organograma" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Organograma</span>
              </NavLink>
              <NavLink to="/time/jornada" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Jornada</span>
              </NavLink>
            </div>
          )}
          </>
          )}
          {can('tickets') && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${chamadosActive ? s.active : ''}`}
            onClick={() => showLabels ? setChamadosOpen(o => !o) : navigate('/backlog')}
          >
            <span className={s.navIcon}><IconBacklog /></span>
            {showLabels && (
              <>
                <span>Chamados</span>
                <span className={`${s.navGroupChevron} ${chamadosOpen ? s.open : ''}`}><IconChevronSmall open={chamadosOpen} /></span>
              </>
            )}
          </button>
          {showLabels && chamadosOpen && (
            <div className={s.navSubList}>
              <NavLink to="/backlog" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Backlog de Chamados</span>
              </NavLink>
              <NavLink to="/chamados-total" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Total de Chamados</span>
              </NavLink>
            </div>
          )}
          </>
          )}
          {can('kb') && (
          <>
          <NavLink to="/base-conhecimento" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
            <span className={s.navIcon}><IconBook /></span>
            {showLabels && <span>Base de Conhecimento</span>}
          </NavLink>
          </>
          )}
          {(can('approvals') || can('purchases') || can('incidents')) && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${flowsActive ? s.active : ''}`}
            onClick={() => showLabels ? setFlowsOpen(o => !o) : navigate('/aprovacoes')}
          >
            <span className={s.navIcon}><IconApprovals /></span>
            {showLabels && (
              <>
                <span>Fluxos</span>
                {!!(pendingApprovalsCount + pendingPurchaseCount) && <span className={s.navCount}>{(pendingApprovalsCount || 0) + (pendingPurchaseCount || 0)}</span>}
                <span className={`${s.navGroupChevron} ${flowsOpen ? s.open : ''}`}><IconChevronSmall open={flowsOpen} /></span>
              </>
            )}
          </button>
          {showLabels && flowsOpen && (
            <div className={s.navSubList}>
              {can('approvals') && (
              <NavLink to="/aprovacoes" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Aprovações</span>
                {!!pendingApprovalsCount && <span className={s.navCount}>{pendingApprovalsCount}</span>}
              </NavLink>
              )}
              {can('purchases') && (
              <div className={s.navSubGroup}>
                <button
                  type="button"
                  className={`${s.navSubGroupHeader} ${purchaseActive ? s.active : ''}`}
                  onClick={() => setPurchaseMonthsOpen(o => !o)}
                >
                  <span>Solicitação de Compra</span>
                  {!!pendingPurchaseCount && <span className={s.navCount}>{pendingPurchaseCount}</span>}
                  <span className={`${s.navGroupChevron} ${purchaseMonthsOpen ? s.open : ''}`}><IconChevronSmall open={purchaseMonthsOpen} /></span>
                </button>
                {purchaseMonthsOpen && (
                  <div className={s.navSubSubList}>
                    <NavLink to="/solicitacoes-compra/todos" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                      <span>Todos os meses</span>
                    </NavLink>
                    {purchaseMonths.map(m => (
                      <NavLink key={m.key} to={`/solicitacoes-compra/${m.key}`} className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                        <span>{m.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
              )}
              {can('incidents') && (
              <div className={s.navSubGroup}>
                <button
                  type="button"
                  className={`${s.navSubGroupHeader} ${incidentsActive ? s.active : ''}`}
                  onClick={() => setIncidentsOpen(o => !o)}
                >
                  <span>Incidentes Laboratórios</span>
                  {!!incidentsTotal && <span className={s.navCount}>{incidentsTotal}</span>}
                  <span className={`${s.navGroupChevron} ${incidentsOpen ? s.open : ''}`}><IconChevronSmall open={incidentsOpen} /></span>
                </button>
                {incidentsOpen && (
                  <div className={s.navSubSubList}>
                    {[['sede', 'SEDE'], ['centro', 'CENTRO'], ['g5', 'G5']].map(([key, label]) => (
                      <NavLink key={key} to={`/incidentes-laboratorios/${key}`} className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                        <span>{label}</span>
                        {!!incidentCounts[key] && <span className={s.navCount}>{incidentCounts[key]}</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          )}
          </>
          )}
          {can('printers') && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${printersActive ? s.active : ''}`}
            onClick={() => showLabels ? setPrintersOpen(o => !o) : navigate('/impressoras/sede')}
          >
            <span className={s.navIcon}><IconPrinter /></span>
            {showLabels && (
              <>
                <span>Impressoras</span>
                {!!printersCount && <span className={s.navCount}>{printersCount}</span>}
                <span className={`${s.navGroupChevron} ${printersOpen ? s.open : ''}`}><IconChevronSmall open={printersOpen} /></span>
              </>
            )}
          </button>
          {showLabels && printersOpen && (
            <div className={s.navSubList}>
              <NavLink to="/impressoras/sede" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>SEDE</span>
              </NavLink>
              <NavLink to="/impressoras/adm" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>ADM</span>
              </NavLink>
              <NavLink to="/impressoras/centro" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>CENTRO</span>
              </NavLink>
              <NavLink to="/impressoras/g5" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>G5</span>
              </NavLink>
              <NavLink to="/impressoras/clinicas" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>CLÍNICAS</span>
              </NavLink>
              <NavLink to="/estoque-insumos/sede" className={() => `${s.navSubItem} ${suppliesActive ? s.active : ''}`}>
                <span>📦 Estoque de insumos</span>
                {!!suppliesLow && <span className={s.navCount} title="Itens no estoque mínimo ou abaixo">{suppliesLow}</span>}
              </NavLink>
            </div>
          )}
          </>
          )}
          {can('loans') && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${equipmentLoansActive ? s.active : ''}`}
            onClick={() => showLabels ? setEquipmentLoansOpen(o => !o) : navigate('/emprestimo-equipamentos/sede')}
          >
            <span className={s.navIcon}><IconSwap /></span>
            {showLabels && (
              <>
                <span>Empréstimo de Equip.</span>
                <span className={`${s.navGroupChevron} ${equipmentLoansOpen ? s.open : ''}`}><IconChevronSmall open={equipmentLoansOpen} /></span>
              </>
            )}
          </button>
          {showLabels && equipmentLoansOpen && (
            <div className={s.navSubList}>
              <NavLink to="/emprestimo-equipamentos/sede" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>SEDE</span>
              </NavLink>
              <NavLink to="/emprestimo-equipamentos/centro" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>CENTRO</span>
              </NavLink>
              <NavLink to="/emprestimo-equipamentos/g5" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>G5</span>
              </NavLink>
            </div>
          )}
          </>
          )}
          {can('companies') && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${companiesActive ? s.active : ''}`}
            onClick={() => showLabels ? setCompaniesOpen(o => !o) : navigate('/empresas/colegio-ser')}
          >
            <span className={s.navIcon}><IconBuilding /></span>
            {showLabels && (
              <>
                <span>Empresas</span>
                {!!companiesCount && <span className={s.navCount}>{companiesCount}</span>}
                <span className={`${s.navGroupChevron} ${companiesOpen ? s.open : ''}`}><IconChevronSmall open={companiesOpen} /></span>
              </>
            )}
          </button>
          {showLabels && companiesOpen && (
            <div className={s.navSubList}>
              <NavLink to="/empresas/colegio-ser" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Colégio SER</span>
              </NavLink>
              <NavLink to="/empresas/unifecaf" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>UniFECAF</span>
              </NavLink>
              <NavLink to="/link-internet" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Link de Internet</span>
              </NavLink>
              <NavLink to="/parceiros" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Parceiros</span>
              </NavLink>
            </div>
          )}
          </>
          )}
          {(can('gestao') || user?.system_role === 'super_admin' || user?.has_vault_access) && (
          <>
          <button
            type="button"
            className={`${s.navGroupHeader} ${gestaoActive ? s.active : ''}`}
            onClick={() => showLabels ? setGestaoOpen(o => !o) : navigate('/gestao/documentos')}
          >
            <span className={s.navIcon}><IconBriefcase /></span>
            {showLabels && (
              <>
                <span>Gestão</span>
                <span className={`${s.navGroupChevron} ${gestaoOpen ? s.open : ''}`}><IconChevronSmall open={gestaoOpen} /></span>
              </>
            )}
          </button>
          {showLabels && gestaoOpen && (
            <div className={s.navSubList}>
              {can('gestao') && (
              <NavLink to="/gestao/documentos" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                <span>Documentos</span>
              </NavLink>
              )}
              {(user?.system_role === 'super_admin' || user?.has_vault_access) && (
                <NavLink to="/gestao/cofre-senhas" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                  <span>Cofre de Senhas</span>
                </NavLink>
              )}
              {/* Tem senhas de Wi-Fi → mesmo controle de acesso do Cofre */}
              {(user?.system_role === 'super_admin' || user?.has_vault_access) && (
                <div className={s.navSubGroup}>
                  <button
                    type="button"
                    className={`${s.navSubGroupHeader} ${vlansActive ? s.active : ''}`}
                    onClick={() => setVlansOpen(o => !o)}
                  >
                    <span>Segmentação de VLANs</span>
                    <span className={`${s.navGroupChevron} ${vlansOpen ? s.open : ''}`}><IconChevronSmall open={vlansOpen} /></span>
                  </button>
                  {vlansOpen && (
                    <div className={s.navSubSubList}>
                      <NavLink to="/gestao/vlans/matriz" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                        <span>Matriz (G5 e SEDE)</span>
                      </NavLink>
                      <NavLink to="/gestao/vlans/administrativo" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                        <span>Administrativo</span>
                      </NavLink>
                    </div>
                  )}
                </div>
              )}
              {/* Sistemas que a equipe desenvolveu — um item por desenvolvimento */}
              {can('gestao') && (
                <div className={s.navSubGroup}>
                  <button
                    type="button"
                    className={`${s.navSubGroupHeader} ${devsActive ? s.active : ''}`}
                    onClick={() => setDevsOpen(o => !o)}
                  >
                    <span>Desenvolvimentos</span>
                    <span className={`${s.navGroupChevron} ${devsOpen ? s.open : ''}`}><IconChevronSmall open={devsOpen} /></span>
                  </button>
                  {devsOpen && (
                    <div className={s.navSubSubList}>
                      <NavLink end to="/gestao/desenvolvimentos" className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                        <span>Ver todos</span>
                      </NavLink>
                      {developments.map(d => (
                        <NavLink key={d.id} to={`/gestao/desenvolvimentos/${d.id}`} className={({ isActive }) => `${s.navSubItem} ${isActive ? s.active : ''}`}>
                          <span>{d.name}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </>
          )}
          {(user?.system_role === 'super_admin' || user?.system_role === 'auditor') && (
            <NavLink to="/admin" className={({ isActive }) => `${s.navItem} ${isActive ? s.active : ''}`}>
              <span className={s.navIcon}><IconShield /></span>
              {showLabels && <span>Administração</span>}
            </NavLink>
          )}
        </nav>

        {/* Boards — "Quadros" agora é um botão que abre/fecha a lista, em
            vez de ficar sempre visível ocupando espaço da sidebar (a grade
            "Meus quadros" que existia na Início saiu de lá — esta lista
            passou a ser o único lugar pra navegar entre os quadros). */}
        {can('boards') && (
        <div className={s.section}>
          {showLabels && (
            <div className={s.sectionHeader}>
              <button type="button" className={s.sectionToggle} onClick={() => setBoardsListOpen(v => !v)}>
                <span>Quadros</span>
                <span className={`${s.navGroupChevron} ${boardsListOpen ? s.open : ''}`}><IconChevronSmall open={boardsListOpen} /></span>
              </button>
              <button className={s.addBtn} onClick={() => setShowCreateBoard(true)} title="Novo quadro">
                <IconPlus />
              </button>
            </div>
          )}
          {(!showLabels || boardsListOpen) && (
          <div className={s.pipeList}>
            {(showLabels && !boardsExpanded ? boards.slice(0, VISIBLE_BOARDS_LIMIT) : boards).map(b => (
              <div key={b.id} className={s.pipeRow}>
                <NavLink
                  to={`/boards/${b.id}`}
                  className={({ isActive }) => `${s.pipeItem} ${isActive ? s.pipeActive : ''}`}
                  title={b.name}
                >
                  <span className={s.pipeColor} style={{ background: b.color || '#3B82F6' }} />
                  {showLabels && <span className={s.pipeName}>{b.name}</span>}
                </NavLink>
                {showLabels && (
                  <div className={s.pipeMenuWrap} ref={menuOpenFor === b.id ? menuRef : null}>
                    <button
                      type="button"
                      className={s.pipeMenuBtn}
                      title="Mais opções"
                      onClick={() => setMenuOpenFor(prev => (prev === b.id ? null : b.id))}
                    >
                      <IconDots />
                    </button>
                    {menuOpenFor === b.id && (
                      <div className={s.pipeMenu}>
                        <button type="button" className={s.pipeMenuItem} onClick={() => archiveBoard(b)}>
                          <IconArchive /> Arquivar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {showLabels && boards.length === 0 && (
              <button className={s.createFirst} onClick={() => setShowCreateBoard(true)}>+ Criar quadro</button>
            )}
            {showLabels && boards.length > VISIBLE_BOARDS_LIMIT && (
              <button type="button" className={s.showMoreBtn} onClick={() => setBoardsExpanded(v => !v)}>
                {boardsExpanded ? '— Ver menos' : `Ver todos (${boards.length})`}
              </button>
            )}
            {showLabels && (
              <button type="button" className={s.showMoreBtn} onClick={() => setShowArchivedBoards(true)}>
                📦 Quadros arquivados
              </button>
            )}
          </div>
          )}
        </div>
        )}

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

      {showCreateBoard && (
        <CreateBoardModal
          onClose={() => setShowCreateBoard(false)}
          onCreated={board => {
            setBoards(prev => [...prev, board].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })))
            setShowCreateBoard(false)
            navigate(`/boards/${board.id}`)
          }}
        />
      )}

      {showArchivedBoards && (
        <ArchivedBoardsModal
          onClose={() => setShowArchivedBoards(false)}
          onRestored={board => setBoards(prev => [...prev, board].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })))}
        />
      )}
    </>
  )
}
