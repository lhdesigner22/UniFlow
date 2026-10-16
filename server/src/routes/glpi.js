import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { runGlpiSync } from '../lib/glpiSync.js'
import { glpiSolveTickets } from '../lib/glpiClient.js'
import { loadDuplicates, solveDuplicates } from '../lib/glpiDuplicateSolver.js'
import { broadcastLive } from '../lib/liveHub.js'
import { loadSeenEntities } from '../lib/glpiEntities.js'

const app = new Hono()
app.use('*', auth)

const superAdmin = async (c, next) => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role === 'super_admin') return await next()
  if (u?.system_role === 'auditor' && c.req.method === 'GET') return await next()
  return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
}
app.use('*', superAdmin)

// POST /sync-now — dispara a sincronização na hora (não espera o cron)
app.post('/sync-now', async c => {
  const db = c.get('db')
  const result = await runGlpiSync(c.env, db)
  // Mexeu na Agenda (esta rota é /admin/glpi, então o aviso automático diria "admin")
  if (result?.created > 0 || result?.duplicates > 0) c.executionCtx.waitUntil(broadcastLive(c.env, { r: 'events', c: c.req.header('X-Client-Id') || undefined }))
  return c.json(result)
})

// ── Resolução retroativa ──────────────────────────────────────────────────
// Eventos importados do GLPI cuja data/hora JÁ PASSOU → o chamado vira
// "Solucionado" no GLPI. Dois passos de propósito (GET prévia → POST
// confirma), porque escreve num sistema externo de produção.
const BATCH_LIMIT = 18 // 2 chamadas ao GLPI por chamado (+ consultas ao D1); Workers Free permite 50 subrequests por execução
const SOLUTION_TEXT = 'Evento realizado. Chamado solucionado automaticamente pelo UniFLOW após a data do evento.'

// Fuso de Brasília fixo em UTC-3 (o Brasil não tem horário de verão hoje).
function nowBrt() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') // 'YYYY-MM-DD HH:MM'
}

// Fim do evento = "Término: HH:MM - YYYY-MM-DD" guardado na descrição (se
// houver); senão o próprio início; sem hora nenhuma, vale o dia inteiro.
function eventEndBrt(ev) {
  const m = String(ev.description || '').match(/Término:\s*(\d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/)
  if (m) return `${m[2]} ${m[1]}`
  return `${ev.event_date} ${ev.event_time || '23:59'}`
}

async function listRetroactive(db) {
  const rows = await db.prepare(`
    SELECT id, glpi_ticket_id, title, description, event_date, event_time
    FROM events
    WHERE glpi_ticket_id IS NOT NULL AND glpi_resolve_state IS NULL
    ORDER BY event_date, event_time
  `).all()
  const now = nowBrt()
  return rows.filter(ev => eventEndBrt(ev) < now)
}

// GET /retroactive — prévia (só banco, não toca no GLPI)
app.get('/retroactive', async c => {
  const rows = await listRetroactive(c.get('db'))
  return c.json(rows.map(ev => ({
    event_id: ev.id, glpi_ticket_id: ev.glpi_ticket_id, title: ev.title,
    event_date: ev.event_date, event_time: ev.event_time, ended_at: eventEndBrt(ev),
  })))
})

// POST /resolve-retroactive — resolve até BATCH_LIMIT chamados por clique
app.post('/resolve-retroactive', async c => {
  const db = c.get('db')
  if (!c.env.GLPI_BASE_URL || !c.env.GLPI_APP_TOKEN || !c.env.GLPI_USER_TOKEN)
    return c.json({ error: 'GLPI não configurado (faltam secrets).' }, 503)

  const pending = await listRetroactive(db)
  const batch = pending.slice(0, BATCH_LIMIT)
  if (batch.length === 0) return c.json({ solved: 0, skipped: 0, errors: [], remaining: 0 })

  const statusRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'glpi_status_id'").get()
  const expectedStatusId = parseInt(statusRow?.value ?? '17', 10)

  const results = await glpiSolveTickets(c.env, {
    ids: batch.map(ev => ev.glpi_ticket_id), expectedStatusId, solutionText: SOLUTION_TEXT,
  })

  let solved = 0, skipped = 0, notFound = 0
  const errors = []
  for (const r of results) {
    if (r.result === 'error') { errors.push({ glpi_ticket_id: r.id, message: r.message }); continue }
    await db.prepare("UPDATE events SET glpi_resolve_state = ?, glpi_resolved_at = datetime('now') WHERE glpi_ticket_id = ?")
      .run(r.result, r.id)
    if (r.result === 'solved') solved++
    else if (r.result === 'not_found') notFound++
    else skipped++
  }
  return c.json({ solved, skipped, notFound, errors, remaining: pending.length - solved - skipped - notFound })
})

// ── Duplicatas ────────────────────────────────────────────────────────────
// Vários chamados do GLPI descrevendo o MESMO evento (mesmo título + data +
// hora, em qualquer sala) não podem aparecer repetidos na Agenda. Regras e
// lógica em lib/glpiDuplicates.js e lib/glpiDuplicateSolver.js.

// GET /duplicates — prévia (só banco)
app.get('/duplicates', async c => {
  const db = c.get('db')
  const { groups, blocked, toSolve, cleanup } = await loadDuplicates(db)
  const items = new Map()
  for (const g of groups) {
    if (!g.duplicates.length && !g.handled.length) continue
    items.set(g.keep.glpi_ticket_id, {
      title: g.keep.title, event_date: g.keep.event_date, event_time: g.keep.event_time,
      keep_ticket_id: g.keep.glpi_ticket_id,
      duplicate_ticket_ids: g.duplicates.map(d => d.glpi_ticket_id),
      cleanup_ticket_ids: g.handled.map(h => h.glpi_ticket_id),
    })
  }
  for (const b of blocked) {
    const item = items.get(b.duplicate_of) || { title: b.title, event_date: b.event_date, event_time: b.event_time, keep_ticket_id: b.duplicate_of, duplicate_ticket_ids: [], cleanup_ticket_ids: [] }
    item.duplicate_ticket_ids.push(b.glpi_ticket_id)
    items.set(b.duplicate_of, item)
  }
  const flags = await db.prepare("SELECT key, value FROM app_settings WHERE key IN ('glpi_dup_autosolve', 'glpi_import_pending')").all()
  const flag = k => flags.find(f => f.key === k)?.value === 'true'
  return c.json({
    items: [...items.values()].sort((a, b) => (a.event_date < b.event_date ? 1 : -1)),
    to_solve: toSolve.length,
    to_clean: cleanup.length,
    background: flag('glpi_dup_autosolve'),       // o cron está solucionando a fila
    importing: flag('glpi_import_pending'),       // ainda há chamados novos esperando entrar na Agenda
  })
})

// POST /resolve-duplicates — (1) tira da Agenda os repetidos que o GLPI já
// tratou; (2) soluciona no GLPI um lote (e tira o evento repetido da Agenda
// só depois de dar certo). Se sobrar fila, liga o processamento em segundo
// plano (cron de 1 min, ver worker.js) que continua até zerar — não precisa
// clicar de novo.
app.post('/resolve-duplicates', async c => {
  const db = c.get('db')
  const stats = await solveDuplicates(c.env, db, { limit: BATCH_LIMIT })

  const workedSomething = stats.cleaned + stats.solved + stats.skipped + stats.notFound > 0
  // Continua em segundo plano se ainda há duplicatas OU chamados novos esperando
  // entrar na Agenda (eles podem render mais duplicatas).
  const importing = (await db.prepare("SELECT value FROM app_settings WHERE key = 'glpi_import_pending'").get())?.value === 'true'
  const canContinue = (stats.remaining > 0 || importing) && stats.errors.length === 0
  await db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('glpi_dup_autosolve', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(canContinue ? 'true' : 'false')

  // Eventos repetidos saíram da Agenda
  if (stats.changedAgenda) c.executionCtx.waitUntil(broadcastLive(c.env, { r: 'events', c: c.req.header('X-Client-Id') || undefined }))

  if (!workedSomething && stats.errors.length) return c.json({ error: stats.errors[0].message }, 503)
  return c.json({ ...stats, background: canContinue })
})

// GET /entities — caminhos de entidade vistos nos chamados do GLPI (a lista de
// escolha da entidade de cada departamento; atualizada a cada minuto pelo Backlog)
app.get('/entities', async c => c.json(await loadSeenEntities(c.get('db'))))

// GET /unparsed — chamados que bateram no filtro mas não foram reconhecidos
app.get('/unparsed', async c => {
  const db = c.get('db')
  const rows = await db.prepare(
    'SELECT * FROM glpi_unparsed_tickets WHERE dismissed = 0 ORDER BY created_at DESC LIMIT 100'
  ).all()
  return c.json(rows)
})

// POST /unparsed/:id/dismiss — marca como revisado (não cria evento, só tira da lista)
app.post('/unparsed/:id/dismiss', async c => {
  const db = c.get('db')
  await db.prepare('UPDATE glpi_unparsed_tickets SET dismissed = 1 WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

export default app
