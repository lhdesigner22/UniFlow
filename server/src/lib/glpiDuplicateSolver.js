// Limpeza de chamados duplicados: usada pelo botão do Admin (Admin → GLPI →
// "Chamados duplicados na Agenda") e, em segundo plano, pelo cron de 1 minuto
// enquanto houver fila (flag `glpi_dup_autosolve`).
//
// Fica o chamado mais antigo de cada grupo (mesmo título + data + hora). Os
// outros:
//   - ainda abertos no GLPI → são solucionados lá ("Chamado duplicado. Tratado
//     no chamado #X") e o evento repetido sai da Agenda;
//   - que o GLPI já tratou (solucionado/pulado/inexistente) → só saem da Agenda;
//   - novos, que a sincronização já barrou (glpi_duplicate_tickets) → são
//     solucionados no GLPI e o registro é marcado.
// As salas dos eventos que saem são somadas na descrição do que fica.
//
// Limite do plano Free (50 subrequests por execução; cada consulta ao D1 conta):
// cada chamado solucionado custa 2 chamadas ao GLPI (conferir status + criar a
// solução) — por isso o `limit` por rodada, e as gravações vão em lote.
import { glpiSolveTickets } from './glpiClient.js'
import { groupDuplicates, roomsOf, mergeRooms } from './glpiDuplicates.js'

export async function loadDuplicates(db) {
  const rows = await db.prepare(`
    SELECT id, glpi_ticket_id, title, description, event_date, event_time, glpi_resolve_state
    FROM events WHERE glpi_ticket_id IS NOT NULL
  `).all()
  const groups = groupDuplicates(rows)
  const blocked = await db.prepare(`
    SELECT glpi_ticket_id, duplicate_of, title, event_date, event_time
    FROM glpi_duplicate_tickets WHERE resolve_state IS NULL ORDER BY glpi_ticket_id
  `).all()

  // A solucionar no GLPI (evento na Agenda ou chamado barrado na importação)
  const toSolve = [
    ...groups.flatMap(g => g.duplicates.map(d => ({ id: d.glpi_ticket_id, keepId: g.keep.glpi_ticket_id, source: 'event' }))),
    ...blocked.map(b => ({ id: b.glpi_ticket_id, keepId: b.duplicate_of, source: 'blocked' })),
  ]
  // Já tratados no GLPI: só saem da Agenda
  const cleanup = groups.flatMap(g => g.handled.map(h => h.glpi_ticket_id))
  return { rows, groups, blocked, toSolve, cleanup }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// Gera as gravações pra tirar `removedIds` da Agenda, somando as salas deles
// na descrição de quem fica.
function removalStatements(groups, removedIds) {
  const removed = new Set(removedIds)
  const statements = []
  for (const g of groups) {
    const gone = [...g.duplicates, ...g.handled].filter(ev => removed.has(ev.glpi_ticket_id))
    if (!gone.length) continue
    const merged = mergeRooms(g.keep.description, gone.flatMap(ev => roomsOf(ev.description)))
    if (merged !== g.keep.description) {
      statements.push({ sql: 'UPDATE events SET description = ? WHERE glpi_ticket_id = ?', args: [merged, g.keep.glpi_ticket_id] })
      g.keep.description = merged // próxima rodada de remoção (mesma execução) soma em cima, sem perder estas salas
    }
  }
  for (const ids of chunk([...removed], 50)) {
    statements.push({ sql: `DELETE FROM events WHERE glpi_ticket_id IN (${ids.map(() => '?').join(',')})`, args: ids })
  }
  return statements
}

// Retorna { cleaned, solved, skipped, notFound, errors, remaining, changedAgenda }
export async function solveDuplicates(env, db, { limit = 18 } = {}) {
  const { groups, toSolve, cleanup } = await loadDuplicates(db)

  // (1) Só sai da Agenda — não precisa do GLPI
  if (cleanup.length) await db.batch(removalStatements(groups, cleanup))

  const batch = toSolve.slice(0, limit)
  const stats = { cleaned: cleanup.length, solved: 0, skipped: 0, notFound: 0, errors: [], remaining: toSolve.length, changedAgenda: cleanup.length > 0 }
  if (!batch.length) return stats

  if (!env.GLPI_BASE_URL || !env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    stats.errors.push({ message: 'GLPI não configurado (faltam secrets).' })
    return stats
  }

  const statusRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'glpi_status_id'").get()
  const expectedStatusId = parseInt(statusRow?.value ?? '17', 10)

  const results = await glpiSolveTickets(env, {
    items: batch.map(b => ({ id: b.id, solutionText: `Chamado duplicado. Tratado no chamado #${b.keepId}.` })),
    expectedStatusId,
  })

  const sourceById = new Map(batch.map(b => [b.id, b.source]))
  const statements = []
  const removeFromAgenda = []
  for (const r of results) {
    if (r.result === 'error') { stats.errors.push({ glpi_ticket_id: r.id, message: r.message }); continue }
    // Solucionado, já tratado por outra pessoa ou inexistente: em qualquer caso
    // o repetido não deve continuar na Agenda.
    if (sourceById.get(r.id) === 'blocked') {
      statements.push({ sql: "UPDATE glpi_duplicate_tickets SET resolve_state = ?, resolved_at = datetime('now') WHERE glpi_ticket_id = ?", args: [r.result, r.id] })
    } else {
      removeFromAgenda.push(r.id)
    }
    if (r.result === 'solved') stats.solved++
    else if (r.result === 'not_found') stats.notFound++
    else stats.skipped++
  }
  if (removeFromAgenda.length) {
    statements.push(...removalStatements(groups, removeFromAgenda))
    stats.changedAgenda = true
  }
  if (statements.length) await db.batch(statements)

  stats.remaining = toSolve.length - stats.solved - stats.skipped - stats.notFound
  return stats
}
