// Cargos, módulos e departamentos — a regra de "quem enxerga o quê".
//
// Três conceitos (inspirados nos "perfis" e "entidades" do GLPI):
//   - MÓDULO: uma área do sistema (Agenda, Empréstimos, Compras...). Lista abaixo.
//   - CARGO (tabela roles): por módulo, 'none' (não vê) | 'view' (só vê) | 'edit'
//     (vê e altera); e um ESCOPO: 'all' (vê todos os departamentos) ou
//     'department' (só o do próprio usuário + o conteúdo "Geral").
//   - DEPARTAMENTO (tabela departments): cada conteúdo pertence a um
//     departamento (coluna department_id; NULL = "Geral", visível a todos).
//
// Super Admin e Auditor continuam sendo definidos por users.system_role (é o que
// as dezenas de checagens antigas usam) e SEMPRE valem mais que a tabela de
// cargos: o Super Admin nunca fica sem acesso por engano de configuração.

export const MODULES = [
  { key: 'boards', label: 'Quadros e cartões', hint: 'Quadros Kanban, cartões e tempo trabalhado' },
  { key: 'agenda', label: 'Agenda', hint: 'Eventos e compromissos' },
  { key: 'metrics', label: 'Métricas e Tempo', hint: 'Métricas do time e relatório de tempo' },
  { key: 'team', label: 'Time', hint: 'Desempenho, Organograma e Jornada' },
  { key: 'tickets', label: 'Chamados (GLPI)', hint: 'Backlog e Total de Chamados' },
  { key: 'kb', label: 'Base de Conhecimento', hint: 'Artigos e anexos' },
  { key: 'gestao', label: 'Gestão', hint: 'Documentos, Desenvolvimentos e Cases de Sucesso' },
  { key: 'approvals', label: 'Aprovações', hint: 'Pedidos de aprovação' },
  { key: 'purchases', label: 'Solicitações de Compra', hint: 'Compras por mês' },
  { key: 'printers', label: 'Impressoras', hint: 'Cadastro e drivers' },
  { key: 'loans', label: 'Empréstimo de Equipamentos', hint: 'Empréstimos, inventário e grade de salas' },
  { key: 'companies', label: 'Empresas, Parceiros e Links', hint: 'Filiais, parceiros e links de internet' },
  { key: 'incidents', label: 'Incidentes Laboratórios', hint: 'Defeitos, sinistros e ocorrências nos laboratórios' },
]
export const MODULE_KEYS = MODULES.map(m => m.key)
export const LEVELS = ['none', 'view', 'edit']

// Primeiro pedaço do caminho (/api/<recurso>/...) → módulo. Recursos que não
// aparecem aqui NÃO são controlados por cargo: auth, notifications, live, users
// (busca de pessoas), vault e vlans (têm lista própria de acesso) e admin (só
// Super Admin, tratado nas próprias rotas).
const RESOURCE_MODULE = {
  boards: 'boards',
  cards: 'boards',
  events: 'agenda',
  metrics: 'metrics',
  'team-kudos': 'team',
  'org-chart': 'team',
  journey: 'team',
  'glpi-backlog': 'tickets',
  'glpi-total': 'tickets',
  kb: 'kb', // Gestão usa a mesma rota com category=gestao — ver moduleForRequest
  developments: 'gestao', // Gestão → Desenvolvimentos
  'success-cases': 'gestao', // Gestão → Cases de Sucesso
  'machine-standards': 'kb', // Base de Conhecimento → Padronização de máquinas
  'lab-incidents': 'incidents',
  approvals: 'approvals',
  'purchase-requests': 'purchases',
  printers: 'printers',
  'printer-supplies': 'printers', // Impressoras → Estoque de insumos
  'equipment-loans': 'loans',
  'equipment-inventory': 'loans',
  'room-schedule': 'loans',
  directory: 'loans',
  companies: 'companies',
  partners: 'companies',
  'internet-links': 'companies',
}

// Módulo que controla uma requisição, ou null se ela não é controlada por cargo.
// `kbCategory`: category da Base de Conhecimento quando a rota é /api/kb —
// "gestao" é a seção Gestão → Documentos (módulo próprio).
export function moduleForRequest(path, { kbCategory } = {}) {
  const parts = path.split('/') // ['', 'api', recurso, ...]
  const resource = parts[2]
  if (resource === 'time') {
    // /api/time/summary e /api/time/export são relatórios (Métricas e Tempo); o
    // resto (iniciar/parar/apagar o próprio tempo) faz parte do trabalho no cartão.
    return parts[3] === 'summary' || parts[3] === 'export' ? 'metrics' : 'boards'
  }
  if (resource === 'kb') return kbCategory === 'gestao' ? 'gestao' : 'kb'
  return RESOURCE_MODULE[resource] || null
}

function allLevels(level) {
  return Object.fromEntries(MODULE_KEYS.map(k => [k, level]))
}

// Acesso efetivo de um usuário: { userId, systemRole, roleId, roleName, scope,
// departmentId, permissions: { módulo: nível } }.
export async function loadAccess(db, userId) {
  const u = await db.prepare(`
    SELECT u.id, u.system_role, u.department_id, u.role_id, u.token_version,
           r.name AS role_name, r.scope AS role_scope, r.permissions AS role_permissions,
           d.module_limits AS dept_limits
    FROM users u
    LEFT JOIN roles r ON r.id = COALESCE(u.role_id, 'role-colaborador')
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(userId)
  if (!u) return null

  const base = { userId: u.id, systemRole: u.system_role || 'user', roleId: u.role_id, departmentId: u.department_id || null, tokenVersion: u.token_version || 0 }

  // Super Admin: tudo, todos os departamentos — sempre, independente do cargo.
  if (u.system_role === 'super_admin') {
    return { ...base, roleName: u.role_name || 'Super Admin', scope: 'all', permissions: allLevels('edit') }
  }
  // Auditor: lê tudo de todos; a única escrita é a Base de Conhecimento (a trava
  // de escrita de verdade é o middleware global em worker.js).
  if (u.system_role === 'auditor') {
    return { ...base, roleName: u.role_name || 'Auditor', scope: 'all', permissions: { ...allLevels('view'), kb: 'edit' } }
  }

  let stored = {}
  try { stored = JSON.parse(u.role_permissions || '{}') } catch { /* cargo com JSON inválido → sem acesso, nunca erro */ }
  const permissions = {}
  for (const k of MODULE_KEYS) permissions[k] = LEVELS.includes(stored[k]) ? stored[k] : 'none'
  // Teto do departamento (Admin → Departamentos → "O que aparece"): vale o menor
  // entre o cargo e o departamento — o departamento só esconde/restringe.
  let limits = {}
  try { limits = JSON.parse(u.dept_limits || '{}') || {} } catch { /* JSON inválido → sem limite */ }
  for (const k of MODULE_KEYS) {
    if (LEVELS.includes(limits[k]) && LEVELS.indexOf(limits[k]) < LEVELS.indexOf(permissions[k])) permissions[k] = limits[k]
  }
  return { ...base, roleName: u.role_name || 'Colaborador', scope: u.role_scope === 'all' ? 'all' : 'department', permissions }
}

export const levelOf = (access, module) => access?.permissions?.[module] || 'none'

// ── Acesso na requisição ─────────────────────────────────────────────────────

// Acesso da requisição atual: o portão em worker.js já carrega e deixa em
// c.get('access'); se por algum motivo não estiver lá, carrega agora.
export async function accessOf(c) {
  return c.get('access') || await loadAccess(c.get('db'), c.get('user').id)
}

// ── Departamentos ────────────────────────────────────────────────────────────
//
// Quem tem escopo 'all' (Super Admin, Auditor, cargos "de todos os departamentos")
// enxerga tudo, mas pode "ver como departamento": o front manda o cabeçalho
// X-Department-View (id do departamento, 'geral' ou 'all') e o portão guarda em
// access.viewDept. Isso só ESTREITA a lista — nunca amplia o acesso de ninguém.

// Pode ver um conteúdo do departamento `deptId`? Geral (NULL) todos veem; escopo
// 'all' vê tudo; senão só o próprio departamento.
export function canSeeDepartment(access, deptId) {
  if (!access) return false
  if (access.scope === 'all') return true
  if (!deptId) return true
  return deptId === access.departmentId
}

// Pedaço de SQL pra filtrar uma listagem por departamento: devolve
// { sql: ' AND (col IS NULL OR col = ?)', args: [dept] } ou vazio (sem filtro).
// Quem não tem departamento só enxerga o conteúdo Geral.
export function departmentFilter(access, column = 'department_id') {
  if (!access) return { sql: ' AND 1=0', args: [] }
  if (access.scope === 'all') {
    const v = access.viewDept
    if (!v || v === 'all') return { sql: '', args: [] }
    if (v === 'geral') return { sql: ` AND ${column} IS NULL`, args: [] }
    return { sql: ` AND (${column} IS NULL OR ${column} = ?)`, args: [v] }
  }
  if (!access.departmentId) return { sql: ` AND ${column} IS NULL`, args: [] }
  return { sql: ` AND (${column} IS NULL OR ${column} = ?)`, args: [access.departmentId] }
}

// Departamento de um conteúdo NOVO. Escopo 'all' pode escolher (inclusive Geral =
// null, passando '' ou null explicitamente); sem escolha usa o departamento que
// está "vendo" ou o próprio. Os demais criam sempre no próprio departamento (ou
// Geral, se não têm).
export function departmentForCreate(access, requested) {
  if (access?.scope === 'all') {
    if (requested === undefined) {
      const v = access.viewDept
      return (v && v !== 'all' && v !== 'geral') ? v : (access.departmentId || null)
    }
    return requested || null
  }
  return access?.departmentId || null
}

// Pode alterar/apagar um conteúdo existente do departamento `deptId`? Escopo 'all'
// sempre. Os demais só no próprio departamento — o conteúdo Geral (compartilhado)
// só quem enxerga tudo altera. `ownedByUser`: quem criou o registro sempre pode
// mexer no que é seu enquanto o enxerga (cobre quem não tem departamento).
export function canModifyDepartment(access, deptId, ownedByUser = false) {
  if (!access) return false
  if (access.scope === 'all') return true
  if (ownedByUser) return canSeeDepartment(access, deptId)
  if (!deptId) return false
  return deptId === access.departmentId
}

// Novo departamento num PUT: só quem tem escopo 'all' pode mover um conteúdo de
// departamento; os demais mantêm o que já estava.
export function departmentForUpdate(access, current, requested) {
  if (access?.scope === 'all' && requested !== undefined) return requested || null
  return current
}
