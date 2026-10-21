// Calcula o snapshot do "Backlog de Chamados" a partir dos dados brutos do
// GLPI e guarda em cache (`glpi_backlog_snapshot`) — chamado pelo cron de
// 15 min, igual à sincronização de eventos. A tela lê sempre o cache, nunca
// bate na API do GLPI na hora do acesso.
//
// Regras replicadas do "Dashboard de Helpdesk GLPI" (projeto irmão):
//   - Em aberto = status != 5 (Resolvido) e != 6 (Fechado)
//   - "Backlog por técnico" exclui filas departamentais (10 Compras,
//     13 Manutenção, 16 Inventário, 17 Eventos) — não são fila de técnico
//     individual, então entram nos KPIs mas não nesse gráfico
//   - Cor do técnico no gráfico: verde ≤3, amarelo 4–6, vermelho ≥7
import { glpiFetchTickets, resolveAssignees, OPEN_STATUS_CODES as GLPI_OPEN_STATUS_CODES } from './glpiClient.js'
import { loadGlpiTechCache } from './glpiTechCache.js'
import { configuredEntities, matchesEntity, entityKey, DEFAULT_ENTITY } from './glpiEntities.js'

const STATUS_LABEL = {
  1: 'Novo', 2: 'Em andamento', 3: 'Aguardando', 4: 'Pendente',
  5: 'Resolvido', 6: 'Fechado',
  10: 'Compras', 13: 'Manutenção', 14: 'RH', 15: 'Desligamento',
  16: 'Inventário', 17: 'Eventos',
}
const PRIORITY_LABEL = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta', 6: 'Crítica' }
const NON_TECH_STATUS = new Set([10, 13, 16, 17])
const AGE_BUCKETS = ['0-7 dias', '8-30 dias', '31-90 dias', '90+ dias']
// Alguns nomes no GLPI foram gravados com a codificação trocada (UTF-8 lido
// como Latin-1: "SubstituiÃ§Ã£o"). Desfaz só quando tem a "cara" disso e o
// resultado é UTF-8 válido; o resto passa como está.
export function fixMojibake(s) {
  if (!s || !/[ÃÂ][\u0080-¿]/.test(s)) return s
  try {
    const bytes = Uint8Array.from([...s].map(ch => ch.charCodeAt(0)))
    if (bytes.some(b => b > 255)) return s
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return s
  }
}

const MONTH_NAMES =['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function techColor(count) {
  if (count >= 7) return 'red'
  if (count >= 4) return 'amber'
  return 'green'
}

// Idade do chamado (desde a criação) — dá pra ver se o backlog é sobretudo
// recente ou se tem muito chamado antigo parado.
function ageBucket(dateCreation) {
  if (!dateCreation) return null
  const created = new Date(dateCreation.replace(' ', 'T') + 'Z')
  const days = Math.floor((Date.now() - created.getTime()) / 86400000)
  if (days <= 7) return AGE_BUCKETS[0]
  if (days <= 30) return AGE_BUCKETS[1]
  if (days <= 90) return AGE_BUCKETS[2]
  return AGE_BUCKETS[3]
}

// Volume de chamados criados por mês (últimos `months` meses com dado) —
// usado tanto no backlog (mostra como o backlog em aberto se acumulou) quanto
// no "Total de Chamados" (volume histórico completo).
function computeMonthlyTrend(tickets, months = 6) {
  const buckets = {}
  for (const t of tickets) {
    const key = String(t.date_creation || '').slice(0, 7) // 'YYYY-MM'
    if (!key || key.length !== 7) continue
    buckets[key] = (buckets[key] || 0) + 1
  }
  return Object.keys(buckets).sort().slice(-months).map(key => {
    const [y, m] = key.split('-')
    return { month: key, label: `${MONTH_NAMES[Number(m) - 1] || m}/${y.slice(2)}`, count: buckets[key] }
  })
}

// `tickets` já vem filtrado do GLPI conforme o chamador (só abertos, pro
// backlog; todos os status, pro "Total de Chamados") — ver glpiClient.js.
// `assigneeNamesByTicket` mapeia ticket.id -> array de nomes de técnico (já
// resolvidos, sem precisar de uma segunda consulta).
export function computeBacklogSnapshot({ tickets, assigneeNamesByTicket }) {
  const byStatus = {}
  for (const code of Object.keys(STATUS_LABEL)) byStatus[code] = 0
  for (const t of tickets) {
    const code = Number(t.status)
    if (code in byStatus) byStatus[code]++
  }

  let semTecnico = 0
  const countByTechName = {}
  for (const t of tickets) {
    if (NON_TECH_STATUS.has(Number(t.status))) continue
    const names = assigneeNamesByTicket[t.id] || []
    if (names.length === 0) { semTecnico++; continue }
    for (const name of names) countByTechName[name] = (countByTechName[name] || 0) + 1
  }
  const byTechnician = Object.entries(countByTechName)
    .map(([name, count]) => ({ name, count, color: techColor(count) }))
    .sort((a, b) => b.count - a.count)

  const byPriority = {}
  for (const code of Object.keys(PRIORITY_LABEL)) byPriority[code] = 0
  for (const t of tickets) {
    const code = Number(t.priority)
    if (code in byPriority) byPriority[code]++
  }

  const byAge = {}
  for (const bucket of AGE_BUCKETS) byAge[bucket] = 0
  for (const t of tickets) {
    const bucket = ageBucket(t.date_creation)
    if (bucket) byAge[bucket]++
  }

  // Por categoria do GLPI — é o que mais diferencia um departamento do outro
  // (as categorias do RH não são as do TI). Guarda o caminho completo
  // ("Infra > Rede > Wi-Fi"), que é como aparece no GLPI.
  const countByCategory = {}
  for (const t of tickets) {
    const cat = fixMojibake(String(t.category || '').trim()) || 'Sem categoria'
    countByCategory[cat] = (countByCategory[cat] || 0) + 1
  }
  const byCategory = Object.entries(countByCategory)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const ticketList = tickets
    .slice()
    .sort((a, b) => (b.date_mod || '').localeCompare(a.date_mod || ''))
    .slice(0, 500)
    .map(t => ({
      id: t.id,
      title: t.name,
      status: Number(t.status),
      statusLabel: STATUS_LABEL[Number(t.status)] || String(t.status),
      priority: Number(t.priority),
      technicians: assigneeNamesByTicket[t.id] || [],
      category: fixMojibake(String(t.category || '').trim()) || null,
      date_creation: t.date_creation,
      date_mod: t.date_mod,
    }))

  return {
    totalOpen: tickets.length,
    byStatus,
    statusLabels: STATUS_LABEL,
    byPriority,
    priorityLabels: PRIORITY_LABEL,
    byAge,
    monthlyTrend: computeMonthlyTrend(tickets),
    semTecnico,
    byTechnician,
    byCategory,
    // Vale pro dashboard: prioridade Alta ou acima, e parados há mais de 30 dias
    highPriority: tickets.filter(t => Number(t.priority) >= 4).length,
    olderThan30: byAge['31-90 dias'] + byAge['90+ dias'],
    tickets: ticketList,
    updatedAt: new Date().toISOString(),
  }
}

const upsert = (table, id, data) => ({
  sql: `INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  args: [id, data],
})

export async function runGlpiBacklogSync(env, db) {
  if (!env.GLPI_BASE_URL || !env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    return { skipped: true, reason: 'GLPI não configurado' }
  }
  // Nome da entidade fixo em "SERVICE DESK" — mesma entidade já usada pelo
  // sync de Eventos (lá filtrada por ID; aqui por nome, já que o texto é o
  // que vem no campo de busca do GLPI — ver nota em glpiClient.js).
  //
  // Roda a cada 1 min (pra manter o backlog quase em tempo real) — por isso
  // busca só os chamados aqui (barato, 1 busca) e resolve o técnico via o
  // cache em D1 (`glpi_tech_cache`, atualizado a cada 15 min por
  // refreshGlpiTechCache), em vez de baixar Ticket_User + User do GLPI de
  // novo a cada execução — isso era o que estava pesando a CPU do Worker
  // quando esse sync passou a rodar todo minuto.
  //
  // Agora cada DEPARTAMENTO aponta pra uma entidade do GLPI (ver glpiEntities.js):
  // baixa os chamados abertos UMA vez (de todas as entidades que o token enxerga —
  // o filtro por entidade já era feito aqui no código, depois da busca) e gera um
  // resumo por entidade configurada, guardado com id `entity:<nome>`.
  const [allTickets, techCache] = await Promise.all([
    glpiFetchTickets(env, { entityName: null, statusCodes: GLPI_OPEN_STATUS_CODES, withCategory: true }),
    loadGlpiTechCache(db),
  ])
  // (Não grava mais a lista de entidades vistas aqui: este sync só vê chamados
  // ABERTOS e sobrescrevia a lista a cada minuto — entidade sem chamado aberto
  // sumia do Admin. Quem acumula é o Total de Chamados; o cadastro completo vem
  // de GET /admin/glpi/entities.)

  const entities = await configuredEntities(db)
  const statements = []
  let main = null
  for (const entity of entities) {
    const tickets = allTickets.filter(t => matchesEntity(t.entity, entity))
    const snapshot = computeBacklogSnapshot({ tickets, assigneeNamesByTicket: resolveAssignees(tickets, techCache) })
    const data = JSON.stringify(snapshot)
    statements.push(upsert('glpi_backlog_snapshot', entityKey(entity), data))
    // 'current' continua existindo (SERVICE DESK) pra qualquer leitor antigo
    if (entity === DEFAULT_ENTITY || (!main && entity === entities[0])) { statements.push(upsert('glpi_backlog_snapshot', 'current', data)); main = snapshot }
  }
  await db.batch(statements)

  return { totalTickets: allTickets.length, entities: entities.length, totalOpen: main?.totalOpen ?? 0, technicians: main?.byTechnician.length ?? 0 }
}
