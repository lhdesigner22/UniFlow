import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { runGlpiBacklogSync } from '../lib/glpiBacklogSync.js'
import { refreshGlpiTechCache } from '../lib/glpiTechCache.js'
import { accessOf } from '../lib/permissions.js'
import { resolveRequestEntity, entityKey, DEFAULT_ENTITY } from '../lib/glpiEntities.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado pode ver o backlog (só leitura)

// GET /?entity= — snapshot cacheado da ENTIDADE do GLPI do departamento da
// pessoa (quem enxerga todos os departamentos pode escolher a entidade).
app.get('/', async c => {
  const db = c.get('db')
  const { entity, entities, noEntity } = await resolveRequestEntity(db, await accessOf(c), c.req.query('entity'))
  if (noEntity) return c.json({ noEntity: true, entities })

  let row = await db.prepare('SELECT data, updated_at FROM glpi_backlog_snapshot WHERE id = ?').get(entityKey(entity))
  // Antes do 1º ciclo depois de configurar, o resumo da entidade ainda não existe.
  // O antigo ('current') era sempre o SERVICE DESK.
  if (!row && entity === DEFAULT_ENTITY) row = await db.prepare("SELECT data, updated_at FROM glpi_backlog_snapshot WHERE id = 'current'").get()
  if (!row) return c.json({ empty: true, entity, entities })
  return c.json({ ...JSON.parse(row.data), updatedAt: row.updated_at, entity, entities })
})

// POST /refresh — super_admin apenas, recalcula na hora (não espera o cron)
app.post('/refresh', async c => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role !== 'super_admin')
    return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  // Refresh manual: também atualiza o cache de técnicos (normalmente só
  // roda a cada 15 min) — clicar "Atualizar agora" deve trazer tudo fresco,
  // não só a lista de chamados.
  await refreshGlpiTechCache(c.env, db).catch(e => console.error('GLPI tech cache refresh error', e.message))
  const result = await runGlpiBacklogSync(c.env, db)
  return c.json(result)
})

export default app
