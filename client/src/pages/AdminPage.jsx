import RolesTab from '../components/admin/RolesTab'
import AuditLogTab from '../components/admin/AuditLogTab'
import UsersTab from '../components/admin/UsersTab'
import DepartmentModulesModal from '../components/admin/DepartmentModulesModal'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import MemberPicker from '../components/common/MemberPicker'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { avatarColor } from '../utils/avatarColor'
import { parseDbTimestamp } from '../utils/formatDuration'
import Reveal from '../components/common/Reveal'
import LineIcon from '../components/common/LineIcon'
import s from './AdminPage.module.css'

const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#64748b']

const ROLE_LABELS = {
  super_admin: { label: '⭐ Super Admin', color: '#f59e0b' },
  auditor:     { label: '👁️ Auditor',     color: '#8b5cf6' },
  user:        { label: '👤 Usuário',     color: '#64748b' },
}

const GLPI_TICKET = 'https://glpi.inventario.unifecaf.edu.br/front/ticket.form.php?id='
const OUTBOX_STATUS = { sent: 'Enviado', failed: 'Falhou', pending: 'Na fila' }
const WEEKDAYS =['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

/**
 * Chips + "adicionar destinatário" reaproveitado nas 3 listas de
 * destinatário desta página (regra de SLA, resumo semanal, alerta diário) —
 * mesmo padrão de MemberPicker + e-mail livre usado no CardModal pra membros.
 */
function RecipientChips({ recipients, onAddUser, onAddEmail, onRemove }) {
  const [showPicker, setShowPicker] = useState(false)
  const [emailInput, setEmailInput] = useState('')

  const submitEmail = () => {
    const email = emailInput.trim()
    if (!email) return
    onAddEmail(email)
    setEmailInput('')
  }

  return (
    <div className={s.recipientsBox}>
      <span className={s.fieldLabel}>Quem recebe</span>
      <div className={s.chipsRow}>
        {recipients.map(r => (
          <span key={r.id} className={s.chip}>
            {r.user_id ? (
              <span className={s.chipDot} style={{ background: avatarColor(r.user_id) }}>
                {(r.user_name || '?').charAt(0).toUpperCase()}
              </span>
            ) : <LineIcon name="mail" size={13} className={s.chipMail} />}
            {r.user_name || r.email}
            <button type="button" className={s.chipRemove} onClick={() => onRemove(r.id)} aria-label={`Tirar ${r.user_name || r.email}`}>×</button>
          </span>
        ))}
        {recipients.length === 0 && <span className={s.emptyHint}>Ninguém ainda. Adicione uma pessoa do UniFlow ou um e-mail de fora.</span>}
      </div>
      <div className={s.addRecipientRow}>
        <div className={s.inviteWrap}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)}>
            <LineIcon name="user" size={14} /> Adicionar pessoa
          </button>
          {showPicker && (
            <MemberPicker
              existingIds={recipients.filter(r => r.user_id).map(r => r.user_id)}
              onPick={u => { onAddUser(u); setShowPicker(false) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        <input
          className={s.emailInput}
          type="email"
          placeholder="E-mail de fora (ex: diretoria@fecaf.com.br)"
          aria-label="E-mail de fora do UniFlow"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitEmail()}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={submitEmail} disabled={!emailInput.trim()}>
          Adicionar e-mail
        </button>
      </div>
    </div>
  )
}

// Interruptor "pausar consultas ao GLPI" (server/src/lib/glpiPause.js). Pausado,
// o UniFlow não fala com o GLPI (crons e botões); as telas ficam com o último
// resumo salvo. Usado quando o servidor do GLPI está fora ou sobrecarregado.
function GlpiPauseCard() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/admin/glpi/pause').then(r => setState(r.data)).catch(() => setState({ paused: false })) }, [])
  const toggle = async () => {
    const pausing = !state.paused
    const ok = await confirmDialog(
      pausing
        ? 'Pausar TODAS as consultas do UniFlow ao GLPI? Backlog, Total de Chamados, importação de Eventos e duplicatas param de atualizar até você religar.'
        : 'Religar as consultas ao GLPI? Na próxima rodada o UniFlow volta a buscar os chamados (o Backlog em até 1 min; Total e técnicos em até 15 min).',
      { title: pausing ? 'Pausar GLPI' : 'Religar GLPI', danger: pausing, confirmLabel: pausing ? 'Pausar' : 'Religar' }
    )
    if (!ok) return
    setBusy(true)
    try { setState((await api.put('/admin/glpi/pause', { paused: pausing })).data) }
    catch (e) { await alertDialog(e.response?.data?.error || 'Não deu pra mudar.', { title: 'Erro', danger: true }) }
    finally { setBusy(false) }
  }
  if (!state) return null
  const when = state.at ? new Date(state.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div className={`${s.statusBar} ${state.paused ? s.statusPaused : ''}`} role="status">
      <span className={s.statusDot} aria-hidden="true" />
      <div className={s.statusText}>
        <strong>{state.paused ? 'Consultas ao GLPI pausadas' : 'Consultas ao GLPI ativas'}</strong>
        <p>
          {state.paused
            ? `O UniFlow não está falando com o GLPI${when ? ` desde ${when}${state.by ? `, por ${state.by}` : ''}` : ''}. Backlog e Total mostram o último resumo salvo.`
            : 'Backlog a cada 1 min; técnicos, Total e Eventos a cada 15 min. Pause se o GLPI estiver fora do ar ou lento.'}
        </p>
      </div>
      <button className={`btn btn-sm ${state.paused ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={toggle}>
        <LineIcon name={state.paused ? 'play' : 'pause'} size={14} />
        {busy ? 'Salvando...' : state.paused ? 'Religar GLPI' : 'Pausar GLPI'}
      </button>
    </div>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { user: me } = useAuthStore()
  // ?tab=logs&category=vault: link do aviso no sininho e do botão do Cofre (vale pra qualquer aba).
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab')
    return ['users', 'roles', 'departments', 'notifications', 'glpi', 'logs'].includes(t) ? t : 'users'
  })
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [roles, setRoles] = useState([])       // cargos (perfis de acesso)
  const [modules, setModules] = useState([])   // módulos do sistema (linhas da matriz de permissões)
  const [defaultRoleId, setDefaultRoleId] = useState('role-colaborador') // cargo de quem entra pela 1ª vez
  const [deptModules, setDeptModules] = useState(null) // departamento com "O que aparece" aberto
  const [glpiEntities, setGlpiEntities] = useState([]) // entidades vistas no GLPI (lista de escolha de cada departamento)
  const [newDept, setNewDept] = useState({ name: '', color: '#4a7cf7' })
  const [deptMsg, setDeptMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Notificações (digests + outbox) ──────────────────────
  const [settings, setSettings] = useState({})
  const [weeklyRecipients, setWeeklyRecipients] = useState([])
  const [dailyRecipients, setDailyRecipients] = useState([])
  const [outbox, setOutbox] = useState({ rows: [], pendingCount: 0 })
  const [settingsMsg, setSettingsMsg] = useState(null)

  const isAuditor = me?.system_role === 'auditor'
  const noDeptCount = users.filter(u => !u.department_id).length
  const superAdminCount = users.filter(u => u.system_role === 'super_admin').length

  useEffect(() => {
    if (me && me.system_role !== 'super_admin' && me.system_role !== 'auditor') { navigate('/'); return }
    Promise.all([
      api.get('/admin/users'),
      api.get('/admin/departments'),
      api.get('/admin/settings').catch(() => ({ data: {} })),
      api.get('/admin/settings/digest-recipients', { params: { type: 'weekly' } }).catch(() => ({ data: [] })),
      api.get('/admin/settings/digest-recipients', { params: { type: 'daily' } }).catch(() => ({ data: [] })),
      api.get('/admin/settings/email-outbox').catch(() => ({ data: { rows: [], pendingCount: 0 } })),
      api.get('/admin/glpi/unparsed').catch(() => ({ data: [] })),
      api.get('/admin/roles').catch(() => ({ data: { roles: [], modules: [] } })),
      api.get('/admin/glpi/entities').catch(() => ({ data: [] })),
    ]).then(([u, d, set, weekly, daily, ob, glpiUnparsed, rl, ent]) => {
      setGlpiEntities(ent.data || [])
      setUsers(u.data)
      setDepartments(d.data)
      setRoles(rl.data?.roles || [])
      setModules(rl.data?.modules || [])
      if (rl.data?.defaultRoleId) setDefaultRoleId(rl.data.defaultRoleId)
      setSettings(set.data || {})
      setWeeklyRecipients(weekly.data || [])
      setDailyRecipients(daily.data || [])
      setOutbox(ob.data || { rows: [], pendingCount: 0 })
      setUnparsedTickets(glpiUnparsed.data || [])
      setLoading(false)
    })
  }, [me])

  // ── Usuários ──────────────────────────────────────────────
  const updateUser = async (userId, patch) => {
    try {
      const { data } = await api.put(`/admin/users/${userId}`, patch)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u))
      if (patch.role_id !== undefined) {
        // recontagem das pessoas por cargo (a lista de cargos mostra "N pessoas")
        const before = users.find(u => u.id === userId)?.role_id
        setRoles(prev => prev.map(r => r.id === before ? { ...r, user_count: Math.max(0, r.user_count - 1) } : r.id === data.role_id ? { ...r, user_count: r.user_count + 1 } : r))
      }
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao salvar.', { title: 'Erro', danger: true })
    }
  }

  const deleteUser = async (userId) => {
    if (!(await confirmDialog('Excluir este usuário? Isso não pode ser desfeito.'))) return
    await api.delete(`/admin/users/${userId}`)
    setUsers(prev => prev.filter(u => u.id !== userId))
  }

  // Derruba a sessão atual da pessoa (token_version) — ela precisa entrar
  // de novo com o Google, o que já sincroniza a foto/nome na hora.
  const forceRelogin = async (u) => {
    const ok = await confirmDialog(
      `Forçar novo login de "${u.name}"? A sessão atual dela é encerrada — na próxima ação ela cai pra tela de login e precisa entrar de novo com o Google.`,
      { title: 'Forçar novo login' }
    )
    if (!ok) return
    try {
      await api.post(`/admin/users/${u.id}/force-relogin`)
      await alertDialog(`Pronto — a sessão de "${u.name}" foi encerrada. Assim que ela entrar de novo, a foto/nome sincronizam com o Google.`, { title: 'Feito' })
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao forçar o novo login.', { title: 'Erro', danger: true })
    }
  }

  // ── Departamentos ─────────────────────────────────────────
  const addDept = async () => {
    if (!newDept.name.trim()) return
    setDeptMsg(null)
    try {
      const { data } = await api.post('/admin/departments', newDept)
      setDepartments(prev => [...prev, data])
      setNewDept({ name: '', color: '#4a7cf7' })
    } catch (e) {
      setDeptMsg({ type: 'error', text: e.response?.data?.error || 'Erro' })
    }
  }

  // Entidade do GLPI do departamento: define quais chamados (Backlog/Total) a equipe dele vê
  const saveDeptEntity = async (dept, value) => {
    const next = value.trim()
    if (next === (dept.glpi_entity_name || '')) return
    try {
      const { data } = await api.put(`/admin/departments/${dept.id}`, { glpi_entity_name: next })
      setDepartments(prev => prev.map(d => d.id === dept.id ? { ...d, glpi_entity_name: data.glpi_entity_name } : d))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao salvar a entidade.', { title: 'Erro', danger: true })
    }
  }

  const deleteDept = async (id) => {
    if (!(await confirmDialog('Excluir departamento? Os usuários associados perderão o vínculo.'))) return
    await api.delete(`/admin/departments/${id}`)
    setDepartments(prev => prev.filter(d => d.id !== id))
    setUsers(prev => prev.map(u => u.department_id === id ? { ...u, department_id: null, department_name: null } : u))
  }

  // ── Notificações ──────────────────────────────────────────
  const updateSetting = async (key, value) => {
    setSettingsMsg(null)
    setSettings(prev => ({ ...prev, [key]: value }))
    try {
      await api.put('/admin/settings', { [key]: value })
    } catch (e) {
      setSettingsMsg({ type: 'error', text: 'Erro ao salvar configuração' })
    }
  }

  const addDigestUser = async (type, user) => {
    const { data } = await api.post('/admin/settings/digest-recipients', { digest_type: type, user_id: user.id })
    if (type === 'weekly') setWeeklyRecipients(prev => [...prev, data])
    else setDailyRecipients(prev => [...prev, data])
  }

  const addDigestEmail = async (type, email) => {
    const { data } = await api.post('/admin/settings/digest-recipients', { digest_type: type, email })
    if (type === 'weekly') setWeeklyRecipients(prev => [...prev, data])
    else setDailyRecipients(prev => [...prev, data])
  }

  const removeDigestRecipient = async (type, id) => {
    await api.delete(`/admin/settings/digest-recipients/${id}`)
    if (type === 'weekly') setWeeklyRecipients(prev => prev.filter(r => r.id !== id))
    else setDailyRecipients(prev => prev.filter(r => r.id !== id))
  }

  // ── GLPI → Agenda ─────────────────────────────────────────
  const [unparsedTickets, setUnparsedTickets] = useState([])
  const [glpiSyncStatus, setGlpiSyncStatus] = useState(null)
  const [syncingGlpi, setSyncingGlpi] = useState(false)

  const syncGlpiNow = async () => {
    setSyncingGlpi(true)
    setGlpiSyncStatus({ type: 'loading', text: 'Sincronizando...' })
    try {
      const { data } = await api.post('/admin/glpi/sync-now')
      if (data.skipped) {
        setGlpiSyncStatus({ type: 'error', text: data.reason || 'Sincronização desativada.' })
      } else {
        setGlpiSyncStatus({
          type: 'success',
          text: `${data.totalMatched} chamado(s) na fila · ${data.created} evento(s) criado(s) · ${data.unparsed} não reconhecido(s) · ${data.skipped} já processado(s) antes${data.duplicates ? ` · ${data.duplicates} repetido(s) não entraram na Agenda` : ''}${data.remaining ? ` · ainda faltam ${data.remaining} chamado(s) novos — continuam entrando sozinhos, um lote por minuto` : ''}.`,
        })
      }
      const up = await api.get('/admin/glpi/unparsed')
      setUnparsedTickets(up.data || [])
    } catch (e) {
      setGlpiSyncStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao sincronizar.' })
    } finally {
      setSyncingGlpi(false)
    }
  }

  // Resolução retroativa: prévia (só lê) → confirma → marca Solucionado no GLPI
  const [retroList, setRetroList] = useState(null)
  const [retroStatus, setRetroStatus] = useState(null)
  const [retroBusy, setRetroBusy] = useState(false)

  const loadRetro = async () => {
    setRetroBusy(true)
    setRetroStatus(null)
    try {
      const { data } = await api.get('/admin/glpi/retroactive')
      setRetroList(data)
    } catch (e) {
      setRetroStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao buscar chamados retroativos.' })
    } finally {
      setRetroBusy(false)
    }
  }

  const resolveRetro = async () => {
    if (!retroList?.length) return
    if (!window.confirm(`Marcar ${retroList.length} chamado(s) como Solucionado no GLPI? Isso altera os chamados no GLPI.`)) return
    setRetroBusy(true)
    setRetroStatus({ type: 'loading', text: 'Solucionando no GLPI...' })
    try {
      const { data } = await api.post('/admin/glpi/resolve-retroactive')
      const err = data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors[0].message}` : ''
      const rest = data.remaining > 0 ? ` · restam ${data.remaining} (clique de novo)` : ''
      setRetroStatus({
        type: data.errors?.length ? 'error' : 'success',
        text: `${data.solved} solucionado(s) · ${data.skipped} pulado(s) (status já tinha mudado)${data.notFound ? ` · ${data.notFound} não encontrado(s) no GLPI (apagado ou sem acesso)` : ''}${rest}${err}`,
      })
      const next = await api.get('/admin/glpi/retroactive')
      setRetroList(next.data)
    } catch (e) {
      setRetroStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao solucionar.' })
    } finally {
      setRetroBusy(false)
    }
  }

  // Duplicatas: mesmo evento em vários chamados → fica o mais antigo, os outros
  // são solucionados no GLPI e saem da Agenda
  const [dupList, setDupList] = useState(null)
  const [dupStatus, setDupStatus] = useState(null)
  const [dupBusy, setDupBusy] = useState(false)
  // dupList = { items, to_solve (a solucionar no GLPI), to_clean (já tratados no GLPI, só saem da Agenda) }
  const dupCount = dupList?.to_solve || 0
  const cleanCount = dupList?.to_clean || 0

  const loadDups = async () => {
    setDupBusy(true)
    setDupStatus(null)
    try {
      const { data } = await api.get('/admin/glpi/duplicates')
      setDupList(data)
    } catch (e) {
      setDupStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao buscar duplicatas.' })
    } finally {
      setDupBusy(false)
    }
  }

  const resolveDups = async () => {
    if (!dupCount && !cleanCount) return
    const parts = []
    if (dupCount) parts.push(`solucionar ${dupCount} chamado(s) duplicado(s) no GLPI (um lote por minuto, em segundo plano)`)
    if (cleanCount) parts.push(`tirar ${cleanCount} evento(s) repetido(s) já tratado(s) da Agenda`)
    if (!window.confirm(`Vou ${parts.join(' e ')}, e remover os eventos repetidos da Agenda. Fica só o chamado mais antigo de cada grupo. Confirmar?`)) return
    setDupBusy(true)
    setDupStatus({ type: 'loading', text: 'Limpando duplicatas...' })
    try {
      const { data } = await api.post('/admin/glpi/resolve-duplicates')
      const err = data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors[0].message}` : ''
      const rest = data.remaining > 0 ? ` · restam ${data.remaining}, continuam sendo solucionados em segundo plano (um lote por minuto, não precisa clicar de novo)` : (data.background ? ' · ainda entrando chamados novos; os repetidos deles serão solucionados em seguida' : '')
      setDupStatus({
        type: data.errors?.length ? 'error' : 'success',
        text: `${data.cleaned ? `${data.cleaned} saíram da Agenda · ` : ''}${data.solved} solucionado(s)${data.skipped ? ` · ${data.skipped} já estavam em outro status` : ''}${data.notFound ? ` · ${data.notFound} não encontrado(s) no GLPI` : ''}${rest}${err}`,
      })
      const next = await api.get('/admin/glpi/duplicates')
      setDupList(next.data)
    } catch (e) {
      setDupStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao solucionar duplicatas.' })
    } finally {
      setDupBusy(false)
    }
  }

  const dismissUnparsed = async (id) => {
    await api.post(`/admin/glpi/unparsed/${id}/dismiss`)
    setUnparsedTickets(prev => prev.filter(t => t.id !== id))
  }

  const [testEmail, setTestEmail] = useState('')
  const [testStatus, setTestStatus] = useState(null)
  const sendTestEmail = async () => {
    if (!testEmail.trim()) return
    setTestStatus({ type: 'loading', text: 'Enviando...' })
    try {
      const { data } = await api.post('/admin/settings/email-outbox/test', { to: testEmail.trim() })
      if (!data.provider) {
        setTestStatus({ type: 'error', text: 'Nenhum provedor de e-mail configurado ainda (nem Cloudflare EMAIL, nem RESEND_API_KEY).' })
      } else if (data.sent > 0) {
        setTestStatus({ type: 'success', text: `Enviado via ${data.provider}! Confira a caixa de entrada de ${testEmail.trim()}.` })
      } else {
        setTestStatus({ type: 'error', text: `Falhou via ${data.provider} — veja a linha na fila abaixo pra detalhes do erro.` })
      }
      const ob = await api.get('/admin/settings/email-outbox')
      setOutbox(ob.data || { rows: [], pendingCount: 0 })
    } catch (e) {
      setTestStatus({ type: 'error', text: e.response?.data?.error || 'Erro ao enviar teste.' })
    }
  }

  const outboxRows = outbox.rows ?? outbox.results ?? []
  const pendingOutboxCount = outbox.pendingCount ?? outboxRows.length ?? 0

  if (loading) return <div className={s.loading}>Carregando...</div>

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Administração</h1>
        <p className={s.sub}>
          {isAuditor && <><strong>Somente leitura</strong> — seu perfil só edita a Base de Conhecimento. </>}
          {users.length} pessoas · {noDeptCount === 0 ? 'todas com departamento' : `${noDeptCount} sem departamento (veem só o Geral)`} · {superAdminCount} Super Admin
        </p>
      </header>

      {/* Abas sublinhadas sobre uma linha (padrão das telas premium, sem emoji) */}
      <nav className={s.tabs} aria-label="Áreas da administração">
        {[
          ['users', 'Usuários', users.length],
          ['roles', 'Cargos', roles.length],
          ['departments', 'Departamentos', departments.length],
          ['notifications', 'Notificações'],
          ['glpi', 'GLPI', unparsedTickets.length || null],
          ['logs', 'Logs'],
        ].map(([key, label, count]) => (
          <button key={key} type="button" aria-current={tab === key ? 'true' : undefined}
            className={`${s.tab} ${tab === key ? s.active : ''}`} onClick={() => setTab(key)}>
            {label}{count != null && <span className={s.badge}>{count}</span>}
          </button>
        ))}
      </nav>

      {/* ── Tab: Logs de auditoria ── */}
      {tab === 'logs' && <AuditLogTab initialCategory={searchParams.get('category') || ''} />}

      {/* ── Tab: Usuários ── */}
      {tab === 'users' && (
        <UsersTab
          users={users} departments={departments} roles={roles} me={me} readOnly={isAuditor}
          onUpdate={updateUser} onForceRelogin={forceRelogin} onDelete={deleteUser}
        />
      )}

      {/* ── Tab: Cargos ── */}
      {tab === 'roles' && (
        <Reveal as="div" className={s.section}>
          <RolesTab roles={roles} modules={modules} setRoles={setRoles} defaultRoleId={defaultRoleId} setDefaultRoleId={setDefaultRoleId} />
        </Reveal>
      )}

      {/* ── Tab: Departamentos ── */}
      {tab === 'departments' && (
        <Reveal as="div" className={s.section}>
          <p className={s.lead}>
            Departamentos agrupam as pessoas por equipe e separam o conteúdo do sistema. A entidade do GLPI define quais
            chamados a equipe vê no Backlog e no Total; sem entidade, o departamento não vê chamados.
          </p>

          <datalist id="glpi-entities">
            {glpiEntities.map(e => <option key={e} value={e} />)}
          </datalist>
          <div className={s.card}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Departamento</th>
                  <th className={s.num}>Pessoas</th>
                  <th>Entidade do GLPI</th>
                  <th>O que aparece</th>
                  <th className={s.actionsCol}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => {
                  const lim = d.module_limits || {}
                  const hidden = Object.values(lim).filter(v => v === 'none').length
                  const viewOnly = Object.values(lim).filter(v => v === 'view').length
                  const summary = hidden || viewOnly
                    ? [hidden && `${hidden} ${hidden === 1 ? 'oculta' : 'ocultas'}`, viewOnly && `${viewOnly} só ver`].filter(Boolean).join(', ')
                    : 'Tudo conforme o cargo'
                  return (
                    <tr key={d.id}>
                      <td>
                        <span className={s.deptName}>
                          <span className={s.deptDot} style={{ background: d.color }} aria-hidden="true" />
                          {d.name}
                        </span>
                      </td>
                      <td className={s.num}>{d.member_count}</td>
                      <td>
                        <input
                          className={s.cellInput}
                          list="glpi-entities"
                          defaultValue={d.glpi_entity_name || ''}
                          key={`${d.id}-${d.glpi_entity_name || ''}`}
                          placeholder="Sem entidade"
                          aria-label={`Entidade do GLPI de ${d.name}`}
                          title="Escolha da lista (vem do GLPI) ou digite o nome. Salva ao sair do campo."
                          disabled={isAuditor}
                          onBlur={e => saveDeptEntity(d, e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                      </td>
                      <td>
                        <button type="button" className={s.linkBtn} disabled={isAuditor} onClick={() => setDeptModules(d)}
                          title="Quais áreas do sistema aparecem para quem é deste departamento">
                          <LineIcon name="eye" size={14} /> {summary}
                        </button>
                      </td>
                      <td className={s.actionsCol}>
                        {!isAuditor && (
                          <button type="button" className={s.iconBtn} onClick={() => deleteDept(d.id)}
                            aria-label={`Excluir o departamento ${d.name}`} title="Excluir departamento">
                            <LineIcon name="trash" size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {departments.length === 0 && (
                  <tr><td colSpan={5} className={s.empty}>Nenhum departamento ainda. Crie o primeiro abaixo.</td></tr>
                )}
              </tbody>
            </table>

            {!isAuditor && (
              <div className={s.addRow}>
                <label htmlFor="new-dept" className={s.addLabel}>Novo departamento</label>
                <input
                  id="new-dept"
                  className={s.addInput}
                  placeholder="Ex: RH, Marketing, Secretaria"
                  value={newDept.name}
                  onChange={e => { setNewDept(d => ({ ...d, name: e.target.value })); setDeptMsg(null) }}
                  onKeyDown={e => e.key === 'Enter' && addDept()}
                />
                <div className={s.swatches} role="radiogroup" aria-label="Cor do departamento">
                  {COLORS.map(c => (
                    <button type="button" key={c} role="radio" aria-checked={newDept.color === c} aria-label={`Cor ${c}`}
                      className={s.swatch} style={{ '--c': c }} onClick={() => setNewDept(d => ({ ...d, color: c }))} />
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={addDept} disabled={!newDept.name.trim()}>
                  Criar departamento
                </button>
              </div>
            )}
          </div>
          {deptMsg && (
            <p role={deptMsg.type === 'error' ? 'alert' : 'status'} className={deptMsg.type === 'error' ? s.msgErr : s.msgOk}>
              {deptMsg.text}
            </p>
          )}
          {deptModules && (
            <DepartmentModulesModal
              dept={deptModules}
              modules={modules}
              onClose={() => setDeptModules(null)}
              onSaved={data => {
                setDepartments(prev => prev.map(x => x.id === data.id ? { ...x, module_limits: data.module_limits } : x))
                setDeptModules(null)
              }}
            />
          )}
        </Reveal>
      )}

      {/* ── Tab: Notificações ── */}
      {tab === 'notifications' && (
        <Reveal as="div" className={s.section}>
          <p className={s.lead}>
            Avisos por e-mail com os eventos da Agenda. Quem é usuário do UniFlow também recebe o aviso no sininho.
          </p>

          <div className={s.panel}>
          {/* Resumo semanal */}
          <section className={s.panelRow} aria-labelledby="dg-weekly">
            <div className={s.digestHeader}>
              <div>
                <h3 id="dg-weekly" className={s.digestTitle}>Resumo semanal</h3>
                <p className={s.digestSub}>Os eventos da semana, num e-mail só.</p>
              </div>
              <label className={s.switch}>
                <span className="sr-only">Enviar o resumo semanal</span>
                <input
                  type="checkbox"
                  checked={settings.weekly_digest_enabled === 'true'}
                  onChange={e => {
                    const enabled = e.target.checked
                    updateSetting('weekly_digest_enabled', enabled ? 'true' : 'false')
                    // Ao ativar, grava já os valores mostrados na UI (mesmo que o
                    // admin não mexa no dia/horário) — sem isso, o backend ficava
                    // sem essa configuração salva e caía no próprio default dele
                    // (18h), diferente do que a tela mostrava (8h), entregando o
                    // resumo numa hora diferente da esperada.
                    if (enabled) {
                      updateSetting('weekly_digest_weekday', settings.weekly_digest_weekday ?? '0')
                      updateSetting('weekly_digest_hour', settings.weekly_digest_hour ?? '18')
                    }
                  }}
                />
                <span className={s.switchTrack} />
              </label>
            </div>

            {settings.weekly_digest_enabled === 'true' && (
              <div className={s.digestConfigRow}>
                <label className={s.smallLabel}>
                  Dia da semana
                  <select
                    value={settings.weekly_digest_weekday ?? '0'}
                    onChange={e => updateSetting('weekly_digest_weekday', e.target.value)}
                  >
                    {WEEKDAYS.map((w, i) => <option key={i} value={String(i)}>{w}</option>)}
                  </select>
                </label>
                <label className={s.smallLabel}>
                  Horário
                  <select
                    value={settings.weekly_digest_hour ?? '18'}
                    onChange={e => updateSetting('weekly_digest_hour', e.target.value)}
                  >
                    {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </label>
              </div>
            )}

            <RecipientChips
              recipients={weeklyRecipients}
              onAddUser={u => addDigestUser('weekly', u)}
              onAddEmail={email => addDigestEmail('weekly', email)}
              onRemove={id => removeDigestRecipient('weekly', id)}
            />
          </section>

          {/* Alerta diário */}
          <section className={s.panelRow} aria-labelledby="dg-daily">
            <div className={s.digestHeader}>
              <div>
                <h3 id="dg-daily" className={s.digestTitle}>Alerta diário</h3>
                <p className={s.digestSub}>Os eventos do dia, no horário escolhido.</p>
              </div>
              <label className={s.switch}>
                <span className="sr-only">Enviar o alerta diário</span>
                <input
                  type="checkbox"
                  checked={settings.daily_digest_enabled === 'true'}
                  onChange={e => {
                    const enabled = e.target.checked
                    updateSetting('daily_digest_enabled', enabled ? 'true' : 'false')
                    if (enabled) updateSetting('daily_digest_hour', settings.daily_digest_hour ?? '22')
                  }}
                />
                <span className={s.switchTrack} />
              </label>
            </div>

            {settings.daily_digest_enabled === 'true' && (
              <div className={s.digestConfigRow}>
                <label className={s.smallLabel}>
                  Horário
                  <select
                    value={settings.daily_digest_hour ?? '22'}
                    onChange={e => updateSetting('daily_digest_hour', e.target.value)}
                  >
                    {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </label>
              </div>
            )}

            <RecipientChips
              recipients={dailyRecipients}
              onAddUser={u => addDigestUser('daily', u)}
              onAddEmail={email => addDigestEmail('daily', email)}
              onRemove={id => removeDigestRecipient('daily', id)}
            />
          </section>
          </div>

          {settingsMsg && (
            <p role="alert" className={s.msgErr}>{settingsMsg.text}</p>
          )}

          {/* Fila de e-mail */}
          <section className={s.card} aria-labelledby="outbox-title">
            <div className={s.cardHead}>
              <div>
                <h3 id="outbox-title" className={s.digestTitle}>Fila de e-mail</h3>
                <p className={s.digestSub}>
                  {pendingOutboxCount > 0
                    ? `${pendingOutboxCount} ${pendingOutboxCount === 1 ? 'e-mail espera' : 'e-mails esperam'} o próximo envio (a cada 15 min).`
                    : 'Nada esperando envio. Os últimos 20 aparecem abaixo.'}
                </p>
              </div>
              <div className={s.testRow}>
                <input
                  className={s.emailInput}
                  type="email"
                  placeholder="Seu e-mail"
                  aria-label="E-mail para receber o teste"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendTestEmail()}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={sendTestEmail} disabled={!testEmail.trim() || testStatus?.type === 'loading'}>
                  <LineIcon name="send" size={14} /> Enviar teste
                </button>
              </div>
            </div>
            {testStatus && (
              <p role="status" className={`${s.cardNote} ${testStatus.type === 'success' ? s.msgOk : testStatus.type === 'error' ? s.msgErr : ''}`}>
                {testStatus.text}
              </p>
            )}

            {outboxRows.length > 0 && (
              <table className={s.table}>
                <thead>
                  <tr><th>Assunto</th><th>Para</th><th>Situação</th><th className={s.num}>Criado em</th></tr>
                </thead>
                <tbody>
                  {outboxRows.slice(0, 20).map(o => (
                    <tr key={o.id}>
                      <td className={s.outboxSubject}>{o.subject}</td>
                      <td className={s.muted}>{o.to_email || o.to_user_name || o.to_user_id || '—'}</td>
                      <td>
                        <span className={`badge ${o.status === 'sent' ? 'badge-green' : o.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>
                          {OUTBOX_STATUS[o.status] || o.status}
                        </span>
                      </td>
                      <td className={`${s.num} ${s.muted}`}>{o.created_at ? parseDbTimestamp(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </Reveal>
      )}

      {/* ── Tab: GLPI ── */}
      {tab === 'glpi' && (
        <Reveal as="div" className={s.section}>
          <GlpiPauseCard />
          <p className={s.lead}>
            A cada 15 min o UniFlow traz do GLPI os chamados da fila Eventos e cria o evento na Agenda com a data e a hora
            da descrição. O que não segue o formato do sistema de reservas fica em "Chamados não reconhecidos", no fim da página.
          </p>

          <section className={s.card} aria-labelledby="glpi-import">
            <div className={s.cardHead}>
              <div>
                <h3 id="glpi-import" className={s.digestTitle}>Importação de eventos</h3>
                <p className={s.digestSub}>De onde vêm os chamados e em qual departamento os eventos aparecem na Agenda.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={syncGlpiNow} disabled={syncingGlpi}>
                <LineIcon name="refresh" size={14} /> Sincronizar agora
              </button>
            </div>
            <div className={s.formGrid}>
              <div className={s.formField}>
                <span className={s.fieldLabel} id="glpi-on-label">Sincronização</span>
                <label className={s.switchRow}>
                  <span className={s.switch}>
                    <input
                      type="checkbox" aria-labelledby="glpi-on-label"
                      checked={settings.glpi_enabled === 'true'}
                      onChange={e => updateSetting('glpi_enabled', e.target.checked ? 'true' : 'false')}
                    />
                    <span className={s.switchTrack} />
                  </span>
                  {settings.glpi_enabled === 'true' ? 'Ligada' : 'Desligada'}
                </label>
              </div>
              <div className={s.formField}>
                <label className={s.fieldLabel} htmlFor="glpi-status">Status da fila no GLPI</label>
                <input id="glpi-status" type="number" value={settings.glpi_status_id ?? '17'}
                  onChange={e => updateSetting('glpi_status_id', e.target.value)} />
              </div>
              <div className={s.formField}>
                <label className={s.fieldLabel} htmlFor="glpi-entity">Entidade (ID)</label>
                <input id="glpi-entity" type="number" value={settings.glpi_entity_id ?? '4'}
                  onChange={e => updateSetting('glpi_entity_id', e.target.value)} />
              </div>
              <div className={s.formField}>
                <label className={s.fieldLabel} htmlFor="glpi-dept">Departamento dos eventos</label>
                <select id="glpi-dept" value={settings.glpi_department_id ?? ''}
                  onChange={e => updateSetting('glpi_department_id', e.target.value)}>
                  <option value="">Geral (todos)</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            {glpiSyncStatus && (
              <p role="status" className={`${s.cardNote} ${glpiSyncStatus.type === 'success' ? s.msgOk : glpiSyncStatus.type === 'error' ? s.msgErr : ''}`}>
                {glpiSyncStatus.text}
              </p>
            )}
          </section>

          <div className={s.panel}>
            <section className={s.panelRow} aria-labelledby="glpi-retro">
              <div className={s.digestHeader}>
                <div>
                  <h3 id="glpi-retro" className={s.digestTitle}>Chamados de eventos que já passaram</h3>
                  <p className={s.digestSub}>Marca como Solucionado no GLPI os chamados cujo evento já terminou, até 20 por vez.</p>
                </div>
                <div className={s.rowActions}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={loadRetro} disabled={retroBusy}>
                    <LineIcon name="search" size={14} /> Ver lista
                  </button>
                  {retroList?.length > 0 && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={resolveRetro} disabled={retroBusy}>
                      <LineIcon name="check" size={14} /> Solucionar {Math.min(retroList.length, 20)} no GLPI
                    </button>
                  )}
                </div>
              </div>
              {retroStatus && (
                <p role="status" className={retroStatus.type === 'success' ? s.msgOk : retroStatus.type === 'error' ? s.msgErr : s.muted}>{retroStatus.text}</p>
              )}
              {retroList && (retroList.length === 0 ? (
                <p className={s.emptyHint}>Nenhum chamado pendente.</p>
              ) : (
                <div className={s.resultList}>
                  <p className={s.resultCount}>{retroList.length} {retroList.length === 1 ? 'chamado pendente' : 'chamados pendentes'}</p>
                  {retroList.map(t => (
                    <div key={t.event_id} className={s.resultItem}>
                      <a href={`${GLPI_TICKET}${t.glpi_ticket_id}`} target="_blank" rel="noreferrer">#{t.glpi_ticket_id}</a>
                      <span>{t.title}</span>
                      <span className={s.muted}>terminou {t.ended_at}</span>
                    </div>
                  ))}
                </div>
              ))}
            </section>

            <section className={s.panelRow} aria-labelledby="glpi-dups">
              <div className={s.digestHeader}>
                <div>
                  <h3 id="glpi-dups" className={s.digestTitle}>Chamados duplicados na Agenda</h3>
                  <p className={s.digestSub}>
                    Mesmo título, data e hora, em qualquer sala (ex: um feriado com um chamado por sala). Fica o mais antigo,
                    com as salas somadas; os outros são solucionados no GLPI apontando pro original e saem da Agenda.
                  </p>
                </div>
                <div className={s.rowActions}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={loadDups} disabled={dupBusy}>
                    <LineIcon name="search" size={14} /> Ver duplicatas
                  </button>
                  {(dupCount > 0 || cleanCount > 0) && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={resolveDups} disabled={dupBusy}>
                      <LineIcon name="check" size={14} /> Limpar duplicatas{dupCount > 0 ? ` (${dupCount} no GLPI)` : ''}
                    </button>
                  )}
                </div>
              </div>
              <label className={s.switchRow}>
                <span className={s.switch}>
                  <input
                    type="checkbox"
                    checked={settings.glpi_dup_auto === 'true'}
                    onChange={e => updateSetting('glpi_dup_auto', e.target.checked ? 'true' : 'false')}
                  />
                  <span className={s.switchTrack} />
                </span>
                Solucionar duplicatas sozinho, a cada minuto
              </label>
              {dupStatus && (
                <p role="status" className={dupStatus.type === 'success' ? s.msgOk : dupStatus.type === 'error' ? s.msgErr : s.muted}>{dupStatus.text}</p>
              )}
              {dupList && (dupList.items.length === 0 ? (
                <p className={s.emptyHint}>Nenhuma duplicata encontrada.</p>
              ) : (
                <div className={s.resultList}>
                  <p className={s.resultCount}>
                    {[
                      dupList.importing && 'importando chamados novos para a Agenda',
                      dupList.background && 'solucionando em segundo plano',
                      `${dupCount} a solucionar no GLPI`,
                      cleanCount > 0 && `${cleanCount} já tratados no GLPI (só saem da Agenda)`,
                      `${dupList.items.length} ${dupList.items.length === 1 ? 'evento' : 'eventos'}`,
                    ].filter(Boolean).join('; ')}
                  </p>
                  {dupList.items.map(g => (
                    <div key={g.keep_ticket_id} className={s.resultItem}>
                      <span>{g.title} <span className={s.muted}>({g.event_date}{g.event_time ? ` ${g.event_time}` : ''})</span></span>
                      <span className={s.muted}>
                        fica <a href={`${GLPI_TICKET}${g.keep_ticket_id}`} target="_blank" rel="noreferrer">#{g.keep_ticket_id}</a>
                        {g.duplicate_ticket_ids.length > 0 && <>; solucionar {g.duplicate_ticket_ids.map((id, i) => (
                          <span key={id}>{i > 0 && ', '}<a href={`${GLPI_TICKET}${id}`} target="_blank" rel="noreferrer">#{id}</a></span>
                        ))}</>}
                        {(g.cleanup_ticket_ids || []).length > 0 && <>; só sai da Agenda: {g.cleanup_ticket_ids.map((id, i) => (
                          <span key={id}>{i > 0 && ', '}<a href={`${GLPI_TICKET}${id}`} target="_blank" rel="noreferrer">#{id}</a></span>
                        ))}</>}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </section>

            <section className={s.panelRow} aria-labelledby="glpi-unparsed">
              <div>
                <h3 id="glpi-unparsed" className={s.digestTitle}>
                  Chamados não reconhecidos{unparsedTickets.length > 0 && <span className={s.titleCount}>{unparsedTickets.length}</span>}
                </h3>
                <p className={s.digestSub}>A descrição não segue o formato do sistema de reservas: crie o evento na Agenda à mão e dispense daqui.</p>
              </div>
              {unparsedTickets.length === 0 ? (
                <p className={s.emptyHint}>Nenhum chamado esperando revisão.</p>
              ) : (
                <div className={s.resultList}>
                  {unparsedTickets.map(t => (
                    <div key={t.id} className={s.unparsed}>
                      <div className={s.unparsedHead}>
                        <a href={`${GLPI_TICKET}${t.glpi_ticket_id}`} target="_blank" rel="noreferrer">
                          #{t.glpi_ticket_id} {t.title || 'sem título'}
                        </a>
                        <span className={s.muted}>{t.reason}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissUnparsed(t.id)}>Dispensar</button>
                      </div>
                      {t.raw_description && (
                        <p className={s.rawDesc}>
                          {t.raw_description.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </Reveal>
      )}
    </div>
  )
}
