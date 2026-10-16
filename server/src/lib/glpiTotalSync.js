// Calcula o snapshot do "Total de Chamados" — mesma ideia do backlog
// (glpiBacklogSync.js), mas sobre TODOS os status (incluindo Resolvido(5) e
// Fechado(6)), pra dar uma visão histórica completa da entidade em vez de só
// o que está em aberto agora. Reaproveita `computeBacklogSnapshot` (KPIs por
// status/prioridade/idade/técnico/mês já funcionam do mesmo jeito sobre
// qualquer lista de chamados) e acrescenta as métricas de resolução que só
// fazem sentido quando o conjunto inclui chamados já fechados.
import { glpiFetchTickets, resolveAssignees, ALL_STATUS_CODES } from './glpiClient.js'
import { loadGlpiTechCache } from './glpiTechCache.js'
import { computeBacklogSnapshot } from './glpiBacklogSync.js'
import { configuredEntities, matchesEntity, entityKey, DEFAULT_ENTITY, distinctEntityPaths, loadSeenEntities, saveSeenEntities } from './glpiEntities.js'

const RESOLVED_CODE = 5
const CLOSED_CODE = 6

function computeResolutionStats(tickets) {
  let resolvedCount = 0
  let closedCount = 0
  let totalDays = 0
  let withDates = 0

  for (const t of tickets) {
    const code = Number(t.status)
    if (code === RESOLVED_CODE) resolvedCount++
    if (code === CLOSED_CODE) closedCount++
    if ((code === RESOLVED_CODE || code === CLOSED_CODE) && t.date_creation && t.date_mod) {
      const created = new Date(String(t.date_creation).replace(' ', 'T') + 'Z')
      const modified = new Date(String(t.date_mod).replace(' ', 'T') + 'Z')
      const days = (modified - created) / 86400000
      if (Number.isFinite(days) && days >= 0) {
        totalDays += days
        withDates++
      }
    }
  }

  const total = tickets.length
  const finalizados = resolvedCount + closedCount
  return {
    resolvedCount,
    closedCount,
    // Chamados que NÃO estão Resolvido/Fechado — ou seja, realmente em
    // aberto ainda. Bug corrigido: antes a página usava `snapshot.totalOpen`,
    // que vem de `computeBacklogSnapshot` e ali significa só "quantidade de
    // chamados neste snapshot" (aqui, TODOS — abertos + finalizados), não
    // "quantos estão em aberto". Por isso "Ainda em aberto" batia igual ao
    // total.
    openCount: total - finalizados,
    resolutionRate: total ? Math.round((finalizados / total) * 1000) / 10 : 0,
    avgResolutionDays: withDates ? Math.round((totalDays / withDates) * 10) / 10 : null,
  }
}

// Monta o snapshot completo (KPIs + gráficos + tabela) a partir de uma lista
// de chamados já filtrada — reaproveitado tanto pelo sync (todo o período)
// quanto pela rota de filtro por data (ver glpiTotal.js), que recalcula isso
// na hora sobre um subconjunto, em JS puro, sem bater no GLPI de novo.
export function buildTotalSnapshot(tickets, assigneeNamesByTicket) {
  const base = computeBacklogSnapshot({ tickets, assigneeNamesByTicket })
  const resolution = computeResolutionStats(tickets)
  return {
    ...base,
    totalTickets: tickets.length,
    ...resolution,
    updatedAt: new Date().toISOString(),
  }
}

const upsert = (table, id, data) => ({
  sql: `INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  args: [id, data],
})

export async function runGlpiTotalSync(env, db) {
  if (!env.GLPI_BASE_URL || !env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    return { skipped: true, reason: 'GLPI não configurado' }
  }
  // Igual ao backlog: busca só os chamados (todos os status, dessa vez) e
  // resolve o técnico via o cache em D1 — sem baixar Ticket_User/User de
  // novo aqui (essa função já roda a cada 15 min, junto com o próprio
  // refresh do cache — ver worker.js `scheduled()`).
  //
  // Cada departamento tem a sua entidade do GLPI (ver glpiEntities.js): baixa tudo
  // uma vez e gera um resumo + um cache "cru" por entidade configurada.
  const [allTickets, techCache] = await Promise.all([
    glpiFetchTickets(env, { entityName: null, statusCodes: ALL_STATUS_CODES }),
    loadGlpiTechCache(db),
  ])
  // Entidades vistas em TODOS os status (o Backlog só vê as que têm chamado aberto) — lista de escolha do Admin
  const seen = new Set([...(await loadSeenEntities(db)), ...distinctEntityPaths(allTickets)])
  await saveSeenEntities(db, [...seen].sort((x, y) => x.localeCompare(y, 'pt-BR')))
  const entities = await configuredEntities(db)
  let main = null
  for (const entity of entities) {
    const tickets = allTickets.filter(t => matchesEntity(t.entity, entity))
    const assigneeNamesByTicket = resolveAssignees(tickets, techCache)
    const snapshot = buildTotalSnapshot(tickets, assigneeNamesByTicket)
    const snapshotJson = JSON.stringify(snapshot)
    // Cache "cru" (todos os chamados, sem o corte de 500 da tabela) — usado
    // pela rota de filtro por data pra recalcular os KPIs sob um período
    // arbitrário sem precisar buscar no GLPI de novo a cada filtro aplicado.
    const rawJson = JSON.stringify({ tickets, assigneeNamesByTicket })
    const statements = [
      upsert('glpi_total_snapshot', entityKey(entity), snapshotJson),
      upsert('glpi_total_raw', entityKey(entity), rawJson),
    ]
    // 'current' continua existindo (SERVICE DESK) pra qualquer leitor antigo
    if (entity === DEFAULT_ENTITY || (!main && entity === entities[0])) {
      statements.push(upsert('glpi_total_snapshot', 'current', snapshotJson), upsert('glpi_total_raw', 'current', rawJson))
      main = snapshot
    }
    await db.batch(statements) // um lote por entidade (cada cache cru pode ser grande)
  }

  return { totalTickets: allTickets.length, entities: entities.length, resolutionRate: main?.resolutionRate }
}
