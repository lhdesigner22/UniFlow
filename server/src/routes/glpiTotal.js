import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { runGlpiTotalSync, buildTotalSnapshot } from '../lib/glpiTotalSync.js'
import { accessOf } from '../lib/permissions.js'
import { isGlpiPaused, PAUSED_MESSAGE } from '../lib/glpiPause.js'
import { resolveRequestEntity, entityKey, DEFAULT_ENTITY, loadHiddenTechs, saveHiddenTechs } from '../lib/glpiEntities.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado pode ver o total (só leitura)

// GET /?from=YYYY-MM-DD&to=YYYY-MM-DD — com `from`/`to`, filtra por data de
// abertura (`date_creation`) e recalcula todos os KPIs/gráficos na hora, em
// JS puro, a partir do cache "cru" (glpi_total_raw — todos os chamados, sem
// bater no GLPI de novo). Sem `from`/`to`, devolve o snapshot padrão (todo o
// período), pré-computado pelo cron a cada 15 min — caminho mais rápido,
// sem filtrar nada.
app.get('/', async c => {
  const db = c.get('db')
  const from = c.req.query('from')
  const to = c.req.query('to')

  // Entidade do GLPI do departamento da pessoa (quem vê tudo escolhe com ?entity=)
  const { entity, entities, noEntity } = await resolveRequestEntity(db, await accessOf(c), c.req.query('entity'))
  if (noEntity) return c.json({ noEntity: true, entities })
  const key = entityKey(entity)
  const hiddenTechnicians = await loadHiddenTechs(db, entity)
  const glpiPaused = await isGlpiPaused(db)
  const legacy = entity === DEFAULT_ENTITY // antes das entidades por departamento, o único resumo era o 'current' (SERVICE DESK)

  if (from || to) {
    let rawRow = await db.prepare('SELECT data, updated_at FROM glpi_total_raw WHERE id = ?').get(key)
    if (!rawRow && legacy) rawRow = await db.prepare("SELECT data, updated_at FROM glpi_total_raw WHERE id = 'current'").get()
    if (!rawRow) return c.json({ empty: true, entity, entities })
    const { tickets, assigneeNamesByTicket } = JSON.parse(rawRow.data)
    const filtered = tickets.filter(t => {
      const created = String(t.date_creation || '').slice(0, 10)
      if (!created) return false
      if (from && created < from) return false
      if (to && created > to) return false
      return true
    })
    const snapshot = buildTotalSnapshot(filtered, assigneeNamesByTicket)
    return c.json({ ...snapshot, updatedAt: rawRow.updated_at, filtered: true, from: from || null, to: to || null, entity, entities, hiddenTechnicians, glpiPaused })
  }

  let row = await db.prepare('SELECT data, updated_at FROM glpi_total_snapshot WHERE id = ?').get(key)
  if (!row && legacy) row = await db.prepare("SELECT data, updated_at FROM glpi_total_snapshot WHERE id = 'current'").get()
  if (!row) return c.json({ empty: true, entity, entities })
  return c.json({ ...JSON.parse(row.data), updatedAt: row.updated_at, entity, entities, hiddenTechnicians, glpiPaused })
})

// PUT /hidden-technicians { entity, names } — técnicos ocultos nos gráficos
// "por técnico" do Total e do Backlog daquela entidade. Super Admin apenas
// (muda o que todo mundo vê). Os chamados continuam contando nos totais.
app.put('/hidden-technicians', async c => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role !== 'super_admin') return c.json({ error: 'Só o Super Admin oculta técnicos.' }, 403)
  const { entity: requested, names } = await c.req.json()
  const { entity, noEntity } = await resolveRequestEntity(db, await accessOf(c), requested)
  if (noEntity || !entity || (requested && entity !== requested)) return c.json({ error: 'Entidade inválida' }, 400)
  if (!Array.isArray(names) || names.length > 300) return c.json({ error: 'Lista inválida' }, 400)
  const clean = [...new Set(names.map(n => String(n ?? '').trim().slice(0, 120)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  await saveHiddenTechs(db, entity, clean)
  return c.json({ entity, hiddenTechnicians: clean })
})

// POST /refresh — super_admin apenas, recalcula na hora (não espera o cron)
//
// Não atualiza o cache de técnicos aqui (como fazia antes) — o botão
// "Atualizar agora" do Backlog e do Total agora disparam os dois refreshes
// (+ o sync de Eventos da Agenda) JUNTOS a partir do cliente
// (ver client/src/utils/glpiRefresh.js), e é o refresh do Backlog quem cuida
// do cache de técnicos. Fazer os dois repetirem esse passo caro (mais uma
// sessão GLPI + download de Ticket_User/User inteiros) era só trabalho
// duplicado toda vez que o admin queria os dois dashboards frescos.
app.post('/refresh', async c => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role !== 'super_admin')
    return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
  if (await isGlpiPaused(db)) return c.json({ error: PAUSED_MESSAGE, paused: true }, 503)

  const result = await runGlpiTotalSync(c.env, db)
  return c.json(result)
})

export default app
