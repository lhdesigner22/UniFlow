// Motor de sincronização GLPI → Agenda. Chamado pelo `scheduled()` do Worker
// (cron de 15 min e, enquanto houver fila grande, também a cada minuto) e pelo
// botão "Sincronizar agora". Idempotente por construção: cada chamado que já
// virou evento (ou foi registrado como repetição) é pulado — não precisa de
// cursor de "último sincronizado".
//
// LIMITE DO PLANO FREE: 50 subrequests por execução, e CADA consulta ao D1
// conta como uma. Por isso esta rodada (1) lê o que já é conhecido em poucas
// consultas, (2) baixa do GLPI só os chamados NOVOS, no máximo `max` por vez,
// e (3) grava tudo numa ÚNICA operação em lote. O que sobrar fica pra próxima
// rodada (flag `glpi_import_pending` faz o cron de 1 min continuar até zerar).
// Antes, cada chamado custava várias consultas e a fila toda era baixada de
// novo a cada rodada — com ~280 chamados a cota acabava antes de chegar nos novos.
//
// Chamados que caem em `glpi_unparsed_tickets` (nenhum parser reconheceu o
// formato) são TENTADOS DE NOVO a cada execução (vão pro fim da fila) —
// importante pra quando um parser novo é adicionado. Só param de ser tentados
// se o usuário clicar "Dispensar" no admin (`dismissed = 1`).
//
// Repetições: um chamado novo com o MESMO título + data + hora de um evento que
// já está na Agenda não vira um segundo evento — é registrado em
// glpi_duplicate_tickets (pra ser solucionado no GLPI) e a sala dele é somada à
// descrição do evento que fica.
import { v4 as uuid } from 'uuid'
import { glpiFetchEventTickets } from './glpiClient.js'
import { parseReservationDescription } from './glpiParser.js'
import { createDupIndex, mergeRooms } from './glpiDuplicates.js'

const UNPARSED_REASON = 'Nenhum formato conhecido reconheceu esta descrição'

async function getSettings(db, keys) {
  const rows = await db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys)
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

const setSettingStmt = (key, value) => ({
  sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  args: [key, value],
})

export async function runGlpiSync(env, db, { max = 30 } = {}) {
  const settings = await getSettings(db, ['glpi_enabled', 'glpi_status_id', 'glpi_entity_id', 'glpi_department_id'])
  if ((settings.glpi_enabled ?? 'false') !== 'true') return { skipped: true, reason: 'Sincronização desativada' }
  if (!env.GLPI_BASE_URL || !env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    return { skipped: true, reason: 'GLPI não configurado (faltam secrets GLPI_BASE_URL/GLPI_APP_TOKEN/GLPI_USER_TOKEN)' }
  }
  const statusId = parseInt(settings.glpi_status_id ?? '17', 10)
  const entityId = parseInt(settings.glpi_entity_id ?? '4', 10)
  const departmentId = settings.glpi_department_id || null // departamento dos eventos importados (vazio = Geral)

  // O que já é conhecido (3 consultas, independente de quantos chamados haja)
  const existingEvents = await db.prepare(
    'SELECT glpi_ticket_id, title, description, event_date, event_time FROM events WHERE glpi_ticket_id IS NOT NULL'
  ).all()
  const duplicateIds = await db.prepare('SELECT glpi_ticket_id FROM glpi_duplicate_tickets').all()
  const unparsedRows = await db.prepare('SELECT id, glpi_ticket_id, dismissed FROM glpi_unparsed_tickets').all()

  const unparsedByTicket = new Map(unparsedRows.map(r => [Number(r.glpi_ticket_id), r]))
  const skipIds = new Set([
    ...existingEvents.map(e => Number(e.glpi_ticket_id)),
    ...duplicateIds.map(d => Number(d.glpi_ticket_id)),
    ...unparsedRows.filter(r => r.dismissed).map(r => Number(r.glpi_ticket_id)),
  ])
  const retryLastIds = new Set(unparsedRows.filter(r => !r.dismissed).map(r => Number(r.glpi_ticket_id)))

  const { tickets, totalInQueue, remaining } = await glpiFetchEventTickets(env, { statusId, entityId, skipIds, retryLastIds, max })

  // Índice dos eventos que já estão na Agenda, agrupados por título + data +
  // horário que se sobrepõe (a sala NÃO conta). Em ordem de número de chamado:
  // se já houver VÁRIOS eventos iguais (ainda não limpos), o que vale é o de
  // menor número — é o que fica depois da limpeza de duplicatas.
  const dupIndex = createDupIndex()
  const keepers = new Set() // eventos "que ficam" cuja descrição pode mudar (salas somadas)
  for (const ev of [...existingEvents].sort((a, b) => a.glpi_ticket_id - b.glpi_ticket_id)) {
    const { duplicate, keeper } = dupIndex.add(ev)
    if (!duplicate) keepers.add(keeper)
  }

  const statements = []
  let created = 0, unparsed = 0, duplicates = 0

  for (const ticket of tickets) {
    const existingUnparsed = unparsedByTicket.get(Number(ticket.id))
    const parsed = parseReservationDescription(ticket)

    if (!parsed) {
      if (existingUnparsed) {
        statements.push({
          sql: 'UPDATE glpi_unparsed_tickets SET title = ?, raw_description = ?, reason = ? WHERE id = ?',
          args: [ticket.name || null, ticket.content || null, UNPARSED_REASON, existingUnparsed.id],
        })
      } else {
        statements.push({
          sql: 'INSERT INTO glpi_unparsed_tickets (id, glpi_ticket_id, title, raw_description, reason) VALUES (?, ?, ?, ?, ?)',
          args: [uuid(), ticket.id, ticket.name || null, ticket.content || null, UNPARSED_REASON],
        })
      }
      unparsed++
      continue
    }

    const extra = []
    if (parsed.location) extra.push(`Sala: ${parsed.location}`)
    if (parsed.end) extra.push(`Término: ${parsed.end.time} - ${parsed.end.date}`)
    extra.push(`Importado do chamado GLPI #${ticket.id}`)

    const title = parsed.title || ticket.name || `Chamado GLPI #${ticket.id}`
    const description = extra.join(' · ')

    // Se um parser novo reconheceu um chamado que antes tinha ficado em
    // "não reconhecido", remove essa linha — ele agora foi entendido (virou
    // evento, ou foi registrado como repetição).
    if (existingUnparsed) statements.push({ sql: 'DELETE FROM glpi_unparsed_tickets WHERE id = ?', args: [existingUnparsed.id] })

    const { duplicate, keeper } = dupIndex.add({
      glpi_ticket_id: ticket.id, title, description, event_date: parsed.event_date, event_time: parsed.event_time,
    })
    if (duplicate) {
      // Mesmo evento já está na Agenda (outro chamado, outra sala): não cria um
      // segundo evento. Registra pra solucionar no GLPI e soma a sala no que fica.
      statements.push({
        sql: 'INSERT INTO glpi_duplicate_tickets (glpi_ticket_id, duplicate_of, title, event_date, event_time) VALUES (?, ?, ?, ?, ?)',
        args: [ticket.id, keeper.ticketId, title, parsed.event_date, parsed.event_time || null],
      })
      if (parsed.location) {
        const merged = mergeRooms(keeper.description, [parsed.location])
        if (merged !== keeper.description) { keeper.description = merged; keeper.changed = true }
      }
      duplicates++
      continue
    }

    statements.push({
      sql: `INSERT INTO events (id, board_id, title, description, event_date, event_time, recurrence_type, created_by, glpi_ticket_id, department_id)
            VALUES (?, NULL, ?, ?, ?, ?, 'none', 'system', ?, ?)`,
      args: [uuid(), title, description, parsed.event_date, parsed.event_time, ticket.id, departmentId],
    })
    keepers.add(keeper)
    created++
  }

  for (const keeper of keepers) {
    if (keeper.changed) statements.push({ sql: 'UPDATE events SET description = ? WHERE glpi_ticket_id = ?', args: [keeper.description, keeper.ticketId] })
  }

  // Sobrou fila? O cron de 1 min continua daqui a pouco (ver worker.js).
  statements.push(setSettingStmt('glpi_import_pending', remaining > 0 ? 'true' : 'false'))

  await db.batch(statements) // uma única chamada ao D1

  return {
    totalMatched: totalInQueue,
    created, unparsed, duplicates, remaining,
    skipped: Math.max(0, totalInQueue - tickets.length - remaining),
  }
}
