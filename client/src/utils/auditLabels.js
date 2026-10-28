// Textos dos logs de auditoria (Admin → Logs e Excel). O servidor grava códigos
// curtos (action 'vault.reveal', 'equipment-loans.create', path '/agenda'…);
// aqui eles viram frases no passado, sempre com o mesmo verbo pra mesma coisa.

export const CATEGORY_LABEL = {
  vault: 'Cofre de Senhas',
  change: 'Alteração',
  page: 'Tela aberta',
  auth: 'Entrada e saída',
  audit: 'Logs',
}

export const SEVERITY_LABEL = { info: 'Normal', warning: 'Atenção', critical: 'Crítico' }

// Áreas do sistema pelo 1º pedaço do caminho da API (/api/<recurso>/...).
const AREA = {
  admin: 'Administração', users: 'Usuários', boards: 'Quadros', events: 'Agenda', kb: 'Base de Conhecimento',
  printers: 'Impressoras', 'printer-supplies': 'Estoque de insumos', metrics: 'Métricas', approvals: 'Aprovações',
  'purchase-requests': 'Solicitações de Compra', companies: 'Empresas', partners: 'Parceiros',
  'internet-links': 'Links de Internet', 'org-chart': 'Organograma', 'team-kudos': 'Desempenho do Time',
  vlans: 'VLANs', 'equipment-loans': 'Empréstimos', 'equipment-inventory': 'Inventário de empréstimos',
  'room-schedule': 'Grade de salas', directory: 'Diretório', journey: 'Jornada', developments: 'Desenvolvimentos',
  'lab-incidents': 'Incidentes Laboratórios', 'success-cases': 'Cases de Sucesso',
  'machine-standards': 'Padronização de máquinas', 'glpi-backlog': 'Backlog de Chamados',
  'glpi-total': 'Total de Chamados', 'time-entries': 'Tempo da equipe',
}
const VERB = { create: 'Criou', update: 'Editou', delete: 'Excluiu', export: 'Exportou' }

// Telas do app pelo caminho (o mais específico primeiro).
const SCREENS = [
  ['/gestao/cofre-senhas', 'Cofre de Senhas'], ['/gestao/vlans', 'VLANs'], ['/gestao/cases-de-sucesso', 'Cases de Sucesso'],
  ['/gestao/desenvolvimentos', 'Desenvolvimentos'], ['/gestao/documentos', 'Documentos da Gestão'], ['/gestao', 'Gestão'],
  ['/boards/', 'Quadro'], ['/backlog', 'Backlog de Chamados'], ['/chamados-total', 'Total de Chamados'],
  ['/base-conhecimento', 'Base de Conhecimento'], ['/aprovacoes', 'Aprovações'], ['/incidentes-laboratorios', 'Incidentes Laboratórios'],
  ['/solicitacoes-compra', 'Solicitações de Compra'], ['/impressoras', 'Impressoras'], ['/estoque-insumos', 'Estoque de insumos'],
  ['/emprestimo-equipamentos', 'Empréstimo de Equipamentos'], ['/empresas', 'Empresas'], ['/link-internet', 'Links de Internet'],
  ['/parceiros', 'Parceiros'], ['/time/desempenho', 'Desempenho do Time'], ['/time/organograma', 'Organograma'],
  ['/time/jornada', 'Jornada'], ['/time', 'Time'], ['/tempo', 'Tempo da equipe'], ['/metricas', 'Métricas'],
  ['/agenda', 'Agenda'], ['/admin', 'Administração'],
]
export function screenName(path) {
  if (!path) return '—'
  if (path === '/') return 'Início'
  const hit = SCREENS.find(([p]) => path.startsWith(p))
  return hit ? hit[1] : path
}

const FIXED = {
  'vault.open': 'Abriu o Cofre de Senhas',
  'vlan.open': 'Abriu as VLANs',
  'vault.reveal': 'Viu a senha',
  'vault.copy': 'Copiou a senha',
  'vlan.reveal': 'Viu a senha do Wi-Fi',
  'vlan.copy': 'Copiou a senha do Wi-Fi',
  'vault.create': 'Cadastrou no Cofre',
  'vault.update': 'Editou no Cofre',
  'vault.delete': 'Excluiu do Cofre',
  'vault.access_grant': 'Deu acesso ao Cofre para',
  'vault.access_revoke': 'Tirou o acesso ao Cofre de',
  'vault.denied': 'Tentou abrir sem autorização',
  'auth.login': 'Entrou no sistema',
  'auth.logout': 'Saiu do sistema',
  'auth.denied': 'Tentou entrar com e-mail não permitido',
  'audit.export': 'Exportou os logs',
}

function parseDetails(row) {
  if (!row.details) return null
  try { return JSON.parse(row.details) } catch { return null }
}

// { what, target, note } — "o que fez", "em quê" e um complemento curto.
export function describe(row) {
  const details = parseDetails(row)
  if (row.action === 'page.view') return { what: 'Abriu a tela', target: screenName(row.target_id), note: row.target_id }
  if (FIXED[row.action]) {
    let note = null
    if (row.action === 'vault.update' && details?.campos?.length) note = `Mudou: ${details.campos.join(', ')}`
    if (row.action === 'auth.login' && details?.primeiro_acesso) note = 'Primeiro acesso'
    if (row.action === 'audit.export' && details?.rows != null) note = `${details.rows} linha(s)`
    const target = row.action === 'vault.open' ? '' : row.target_label || (row.action.startsWith('auth.') ? '' : '—')
    return { what: FIXED[row.action], target, note }
  }
  // Alteração genérica: "Criou · Empréstimos", "Tentou excluir (sem permissão) · Compras".
  const [resource, verb] = row.action.split('.')
  const denied = row.status === 401 || row.status === 403
  return {
    what: denied ? `Tentou ${INFINITIVE[verb] || verb} (sem permissão)` : (VERB[verb] || verb),
    target: AREA[resource] || resource,
    note: row.status >= 400 && !denied ? `Não concluiu (erro ${row.status})` : null,
  }
}

const INFINITIVE = { create: 'criar', update: 'editar', delete: 'excluir', export: 'exportar' }

// Navegador legível a partir do User-Agent (o suficiente pra "de onde foi").
export function browserName(ua) {
  if (!ua) return '—'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Outro'
  return os ? `${br} · ${os}` : br
}
