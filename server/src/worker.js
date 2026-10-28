import { Hono } from 'hono'
import { createDb } from './db.js'
import { tokenPayload } from './lib/requestToken.js'
import { loadAccess, levelOf, moduleForRequest } from './lib/permissions.js'

import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import usersRoutes from './routes/users.js'
import notificationsRoutes from './routes/notifications.js'
import boardsRoutes from './routes/boards.js'
import columnsRoutes from './routes/columns.js'
import cardsRoutes from './routes/cards.js'
import timeEntriesRoutes from './routes/timeEntries.js'
import slaRulesRoutes from './routes/slaRules.js'
import eventsRoutes from './routes/events.js'
import appSettingsRoutes from './routes/appSettings.js'
import glpiRoutes from './routes/glpi.js'
import glpiBacklogRoutes from './routes/glpiBacklog.js'
import glpiTotalRoutes from './routes/glpiTotal.js'
import kbRoutes from './routes/kb.js'
import printersRoutes from './routes/printers.js'
import metricsRoutes from './routes/metrics.js'
import approvalsRoutes from './routes/approvals.js'
import purchaseRequestsRoutes from './routes/purchaseRequests.js'
import companiesRoutes from './routes/companies.js'
import partnersRoutes from './routes/partners.js'
import internetLinksRoutes from './routes/internetLinks.js'
import orgChartRoutes from './routes/orgChart.js'
import teamKudosRoutes from './routes/teamKudos.js'
import vaultRoutes from './routes/vault.js'
import vlansRoutes from './routes/vlans.js'
import equipmentLoansRoutes from './routes/equipmentLoans.js'
import equipmentInventoryRoutes from './routes/equipmentInventory.js'
import roomScheduleRoutes from './routes/roomSchedule.js'
import directoryRoutes from './routes/directory.js'
import journeyRoutes from './routes/journey.js'
import liveRoutes from './routes/live.js'
import developmentsRoutes from './routes/developments.js'
import labIncidentsRoutes from './routes/labIncidents.js'
import successCasesRoutes from './routes/successCases.js'
import machineStandardsRoutes from './routes/machineStandards.js'
import printerSuppliesRoutes from './routes/printerSupplies.js'
import auditRoutes from './routes/audit.js'
import { broadcastLive } from './lib/liveHub.js'
import { auditInBackground, purgeAuditLogs } from './lib/audit.js'

// O Durable Object precisa ser exportado do módulo principal do Worker.
export { LiveHub } from './lib/liveHub.js'

import { runSlaSweep, runDigests } from './lib/schedule.js'
import { flushOutbox } from './lib/email.js'
import { runGlpiSync } from './lib/glpiSync.js'
import { solveDuplicates } from './lib/glpiDuplicateSolver.js'
import { runGlpiBacklogSync } from './lib/glpiBacklogSync.js'
import { runGlpiTotalSync } from './lib/glpiTotalSync.js'
import { runRoomScheduleSync } from './lib/roomScheduleSync.js'
import { refreshGlpiTechCache } from './lib/glpiTechCache.js'
import { isGlpiPaused } from './lib/glpiPause.js'
import { syncLoanReplies, gmailInboxConfigured, gmailInboxOverdue } from './lib/gmailInbox.js'

const app = new Hono()

// Cria a instância de `db` (D1) uma vez por requisição, a partir do binding do Worker,
// e disponibiliza para todas as rotas via c.get('db') — mesmo shape que as rotas já usam.
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env))
  await next()
})

// Cabeçalhos de segurança das respostas da API (os arquivos estáticos recebem
// os seus por client/public/_headers). `no-store`: dado de API nunca fica em
// cache do navegador/proxy — a não ser que a rota já tenha definido o seu.
app.use('/api/*', async (c, next) => {
  await next()
  if (c.res.status === 101) return // WebSocket — cabeçalhos imutáveis
  // Resposta repassada direto de um fetch() tem cabeçalhos imutáveis → copia.
  try { c.res.headers.set('X-Content-Type-Options', 'nosniff') } catch { c.res = new Response(c.res.body, c.res) }
  const h = c.res.headers
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('X-Frame-Options', 'DENY')
  h.set('Referrer-Policy', 'no-referrer')
  h.set('Strict-Transport-Security', 'max-age=31536000')
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox")
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store')
})

// Logs de auditoria (lib/audit.js): toda alteração (POST/PUT/PATCH/DELETE) —
// inclusive as recusadas por falta de permissão — e toda exportação (GET em
// .../export). Sem corpo da requisição: só quem, quando, de onde e qual caminho.
// Ficam de fora: o Cofre (registra com mais detalhe na própria rota), o login
// (idem, em auth.js), os próprios logs, avisos de leitura e o tempo real.
const AUDIT_SKIP_RESOURCES = new Set(['live', 'auth', 'notifications', 'audit', 'vault'])
const AUDIT_VERBS = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }
app.use('/api/*', async (c, next) => {
  await next()
  const parts = c.req.path.split('/') // ['', 'api', recurso, id?, ...]
  const resource = parts[2]
  if (!resource || AUDIT_SKIP_RESOURCES.has(resource)) return
  const isExport = c.req.method === 'GET' && parts.includes('export')
  const verb = AUDIT_VERBS[c.req.method]
  if (!verb && !isExport) return
  if (!c.get('user')) return // sem login: a rota já respondeu 401, nada a atribuir
  const status = c.res.status
  auditInBackground(c, {
    category: 'change',
    action: `${resource}.${isExport ? 'export' : verb}`,
    severity: status === 401 || status === 403 ? 'warning' : 'info',
    status,
    targetId: parts[3] || null,
  })
})

// ACESSO POR CARGO — um único portão para o sistema inteiro (em vez de repetir
// a checagem rota por rota, que é fácil esquecer). Para cada requisição:
//   1. carrega o acesso da pessoa (cargo + departamento) — 1 consulta — e deixa
//      em c.get('access'), pras rotas filtrarem por departamento;
//   2. descobre de qual MÓDULO é a rota (Agenda, Empréstimos, Compras...);
//   3. cargo sem acesso ao módulo → 403; cargo que só pode VER → só leitura (GET).
// Recursos fora da lista de módulos (auth, notificações, busca de pessoas, cofre,
// VLANs, admin) têm controle próprio nas rotas.
//
// Perfil "Auditor" (system_role='auditor'): enxerga tudo de todo mundo, mas não
// pode alterar NADA além da Base de Conhecimento — essa regra também mora aqui:
// qualquer requisição não-GET dele é rejeitada antes de chegar nas rotas.
const NO_ACCESS_CHECK = new Set(['auth', 'notifications', 'live'])
app.use('/api/*', async (c, next) => {
  const resource = c.req.path.split('/')[2]
  if (!resource || NO_ACCESS_CHECK.has(resource)) return await next()

  let payload
  try {
    payload = await tokenPayload(c)
  } catch {
    return await next() // token inválido — a auth de cada rota resolve com 401
  }
  if (!payload) return await next() // sem token — a auth de cada rota resolve com 401

  const db = c.get('db')
  const access = await loadAccess(db, payload.id)
  // Usuário excluído, ou sessão derrubada pelo "Forçar novo login" (o
  // token_version do banco andou): corta na hora, sem esperar o token expirar.
  if (!access) return c.json({ error: 'Usuário não encontrado — faça login novamente.' }, 401)
  if ((payload.tv || 0) !== access.tokenVersion) return c.json({ error: 'Sessão renovada — faça login novamente.' }, 401)
  c.set('user', payload)
  // "Ver como departamento" (só pra quem enxerga tudo): estreita as listas, nunca amplia.
  if (access.scope === 'all') {
    const view = c.req.header('X-Department-View')
    if (view) access.viewDept = view
  }
  c.set('access', access)

  const method = c.req.method
  const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'

  // 'audit': o Auditor também registra as telas que abre (POST /api/audit/view).
  if (!isRead && access.systemRole === 'auditor' && resource !== 'kb' && resource !== 'audit') {
    return c.json({ error: 'Este perfil (Auditor) tem acesso só de leitura — a única exceção é a Base de Conhecimento.' }, 403)
  }

  // A Base de Conhecimento serve também a Gestão (category=gestao): o módulo
  // depende da categoria — na URL, no corpo (criar/editar) ou no artigo (apagar).
  // Ordem importa (falha corrigida em out/2026): com id na rota vale SEMPRE a
  // categoria do artigo, e ao criar vale a do corpo — o ?category= da URL só
  // serve pra listagem. Antes o ?category=outro passava na frente e deixava
  // quem não tem a Gestão baixar/criar documento dela. Mudar a categoria de
  // um artigo no PUT é checado na própria rota (kb.js).
  let kbCategory
  if (resource === 'kb') {
    const articleId = c.req.path.split('/')[3]
    if (articleId) kbCategory = (await db.prepare('SELECT category FROM kb_articles WHERE id = ?').get(articleId))?.category
    else if (!isRead) { try { kbCategory = (await c.req.raw.clone().json())?.category } catch { /* sem corpo JSON */ } }
    else kbCategory = c.req.query('category')
  }

  const module = moduleForRequest(c.req.path, { kbCategory })
  if (module) {
    const level = levelOf(access, module)
    if (level === 'none') return c.json({ error: 'Seu cargo não tem acesso a esta área.' }, 403)
    if (!isRead && level === 'view') return c.json({ error: 'Seu cargo só pode visualizar esta área (sem alterar).' }, 403)
  }
  await next()
})

// Tempo real: depois de QUALQUER alteração bem-sucedida (POST/PUT/PATCH/DELETE),
// avisa os aparelhos conectados que aquele recurso mudou — o recurso é o 1º
// pedaço do caminho (/api/equipment-loans/... → "equipment-loans"). Fica antes
// das rotas, então vale pra todas sem precisar mexer em cada uma. Sai em
// segundo plano (waitUntil), não atrasa a resposta. O X-Client-Id deixa o
// aparelho que fez a alteração ignorar o próprio aviso (ele já se atualizou).
const LIVE_SKIP_RESOURCES = new Set(['live', 'auth', 'notifications', 'audit'])
app.use('/api/*', async (c, next) => {
  await next()
  const method = c.req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
  if (c.res.status >= 400) return
  const parts = c.req.path.split('/') // ['', 'api', recurso, ...]
  const resource = parts[2]
  if (!resource || LIVE_SKIP_RESOURCES.has(resource)) return
  c.executionCtx.waitUntil(broadcastLive(c.env, {
    r: resource,
    b: resource === 'boards' ? parts[3] : undefined, // id do quadro, pra só recarregar o quadro certo
    s: resource === 'boards' ? parts[4] : undefined, // 'cards', 'columns'... (a lista de quadros do menu só muda sem isso)
    c: c.req.header('X-Client-Id') || undefined,
  }))
})

// Routes
app.route('/api/live', liveRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/notifications', notificationsRoutes)
app.route('/api/boards', boardsRoutes)
app.route('/api/boards/:boardId/columns', columnsRoutes)
app.route('/api/boards/:boardId/cards', cardsRoutes)
app.route('/api', timeEntriesRoutes)
app.route('/api/admin/sla-rules', slaRulesRoutes)
app.route('/api/events', eventsRoutes)
app.route('/api/admin/settings', appSettingsRoutes)
app.route('/api/admin/glpi', glpiRoutes)
app.route('/api/glpi-backlog', glpiBacklogRoutes)
app.route('/api/glpi-total', glpiTotalRoutes)
app.route('/api/kb', kbRoutes)
app.route('/api/printers', printersRoutes)
app.route('/api/metrics', metricsRoutes)
app.route('/api/approvals', approvalsRoutes)
app.route('/api/purchase-requests', purchaseRequestsRoutes)
app.route('/api/companies', companiesRoutes)
app.route('/api/partners', partnersRoutes)
app.route('/api/internet-links', internetLinksRoutes)
app.route('/api/org-chart', orgChartRoutes)
app.route('/api/team-kudos', teamKudosRoutes)
app.route('/api/vault', vaultRoutes)
app.route('/api/vlans', vlansRoutes)
app.route('/api/equipment-loans', equipmentLoansRoutes)
app.route('/api/equipment-inventory', equipmentInventoryRoutes)
app.route('/api/room-schedule', roomScheduleRoutes)
app.route('/api/directory', directoryRoutes)
app.route('/api/journey', journeyRoutes)
app.route('/api/developments', developmentsRoutes)
app.route('/api/lab-incidents', labIncidentsRoutes)
app.route('/api/success-cases', successCasesRoutes)
app.route('/api/machine-standards', machineStandardsRoutes)
app.route('/api/printer-supplies', printerSuppliesRoutes)
app.route('/api/audit', auditRoutes)

async function processGlpiQueues(env, db) {
  const flags = await db.prepare("SELECT key, value FROM app_settings WHERE key IN ('glpi_import_pending', 'glpi_dup_autosolve', 'glpi_dup_auto')").all()
  const on = k => flags.find(f => f.key === k)?.value === 'true'
  const setFlag = (k, v) => db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(k, v)

  if (on('glpi_import_pending')) {
    const r = await runGlpiSync(env, db, { max: 25 })
    if (r?.skipped) await setFlag('glpi_import_pending', 'false') // desativada/sem credenciais: não insiste
    else if (r.created > 0 || r.duplicates > 0) await broadcastLive(env, { r: 'events' })
    return
  }

  // `glpi_dup_auto` = opção PERMANENTE do Admin ("solucionar duplicatas
  // automaticamente"): toda duplicata nova é solucionada sozinha, sem clique.
  // `glpi_dup_autosolve` = temporária, ligada pelo botão "Limpar duplicatas"
  // até a fila zerar.
  const permanent = on('glpi_dup_auto')
  if (on('glpi_dup_autosolve') || permanent) {
    const s = await solveDuplicates(env, db, { limit: 12 })
    if (s.changedAgenda) await broadcastLive(env, { r: 'events' })
    const progressed = s.solved + s.skipped + s.notFound > 0
    // Acabou a fila (ou travou: erro de permissão etc.) → desliga o segundo plano
    // temporário. A opção permanente continua ligada e tenta de novo no próximo minuto.
    if (s.remaining === 0 || (!progressed && s.errors.length > 0)) await setFlag('glpi_dup_autosolve', 'false')
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    const db = createDb(env)
    // Interruptor do Admin → GLPI: pausado = nenhum cron fala com o GLPI
    // (Backlog, filas/duplicatas, Eventos, técnicos, Total). O resto (e-mail,
    // SLA, resumos, grade de salas) segue normal. 1 consulta ao banco.
    const glpiOn = !(await isGlpiPaused(db).catch(() => false))

    // "* * * * *" — a cada 1 min: SÓ a busca de chamados em aberto do
    // Backlog (uma única chamada de busca ao GLPI, ~1 página). Não resolve
    // técnico aqui — usa o cache já pronto em D1 (ver glpi_tech_cache) em
    // vez de baixar Ticket_User/User de novo a cada execução. Essa
    // separação existe porque rodar a resolução de técnico (a parte cara)
    // a cada 1 min foi o que disparou o consumo de CPU do Worker.
    if (event.cron === '* * * * *') {
      // Respostas por e-mail dos avisos de empréstimo → chat (lib/gmailInbox.js).
      // Roda nos minutos terminados em 3 ou 8 e, se a última leitura tiver mais
      // de 7 min (uma rodada falhou), no minuto seguinte. Vai ANTES do Backlog:
      // antes vinha depois e, quando o Backlog demorava/gastava mais, a leitura
      // nem chegava a rodar (ficou dezenas de minutos parada em produção).
      const minute = new Date(event.scheduledTime || Date.now()).getUTCMinutes()
      const readMail = gmailInboxConfigured(env) && (minute % 5 === 3 || await gmailInboxOverdue(db))
      if (readMail) {
        await syncLoanReplies(env, db)
          .then(r => { if (r.matched > 0) return broadcastLive(env, { r: 'equipment-loans' }) })
          .catch(e => console.error('Gmail inbox sync error', e.message))
      }

      if (glpiOn) await runGlpiBacklogSync(env, db).catch(e => console.error('GLPI backlog sync error', e.message))

      // Filas grandes do GLPI processadas aos poucos, um lote por minuto (o
      // limite de 50 subrequests por execução não deixa fazer tudo de uma vez).
      // Só UM dos dois por minuto, pra somar com o backlog acima sem estourar:
      //   1) importação de chamados novos pra Agenda, enquanto sobrar fila;
      //   2) depois, a limpeza de duplicatas (ligada pelo botão do Admin).
      // Com as duas flags desligadas isso custa 1 consulta ao banco por minuto.
      // No minuto em que leu os e-mails, pula as filas (limite de subrequests);
      // elas só atrasam 1 minuto.
      if (!readMail && glpiOn) {
        await processGlpiQueues(env, db).catch(e => console.error('GLPI queues error', e.message))
      }
    }

    // "*/15 * * * *" — SLA + digests + sync de Eventos pra Agenda + outbox.
    //
    // IMPORTANTE: cada passo tem seu próprio catch, isolado dos outros. Bug
    // real encontrado e corrigido aqui: nenhum desses passos tinha catch —
    // se QUALQUER um lançasse uma exceção, tudo que vinha DEPOIS naquele
    // tick era abortado, inclusive `flushOutbox` — ou seja, `runDigests`
    // enfileirava o e-mail do resumo diário/semanal certinho, mas ele nunca
    // chegava a ser enviado de verdade porque um passo seguinte quebrava
    // antes de chegar no flush (aconteceu de verdade: 3 dias seguidos de
    // "Compromissos de hoje" ficaram presos como pending). Isolando cada
    // passo, uma falha num não impede mais os outros de rodar.
    if (event.cron === '*/15 * * * *') {
      await runSlaSweep(env, db).catch(e => console.error('SLA sweep error', e.message))
      await runDigests(env, db).catch(e => console.error('Digests error', e.message))
      if (glpiOn) await runGlpiSync(env, db)
        .then(r => { if (r?.created > 0) return broadcastLive(env, { r: 'events' }) }) // eventos novos na Agenda → atualiza quem estiver olhando
        .catch(e => console.error('GLPI events sync error', e.message))
      await flushOutbox(env, db).catch(e => console.error('Flush outbox error', e.message))
      // Uma vez por dia (06:00 UTC = 03:00 de Brasília): logs de auditoria vencidos.
      const when = new Date(event.scheduledTime || Date.now())
      if (when.getUTCHours() === 6 && when.getUTCMinutes() < 15) {
        await purgeAuditLogs(db).catch(e => console.error('Audit purge error', e.message))
      }
    }

    // "5,20,35,50 * * * *" — refresh do cache de técnicos: baixa TODA a
    // coleção de Ticket_User + User do GLPI. Isolado num tick próprio (não
    // junto com Eventos/Total) por causa do limite de 50 subrequests POR
    // INVOCAÇÃO do Worker Free — cada init/kill de sessão e cada página
    // paginada do GLPI conta como 1 subrequest, e empilhar essa busca com
    // outras no mesmo tick estourava esse limite (erro real visto em
    // produção: "Too many subrequests by single Worker invocation").
    if (event.cron === '5,20,35,50 * * * *') {
      if (glpiOn) await refreshGlpiTechCache(env, db).catch(e => console.error('GLPI tech cache refresh error', e.message))
    }

    // "10,25,40,55 * * * *" — "Total de Chamados": varre TODO o histórico da
    // entidade (milhares de chamados resolvidos/fechados). Isolado no seu
    // próprio tick pelo mesmo motivo do cache de técnicos acima — 5 min
    // depois dele, então já lê o cache de técnicos fresco desta mesma volta.
    if (event.cron === '10,25,40,55 * * * *') {
      if (glpiOn) await runGlpiTotalSync(env, db).catch(e => console.error('GLPI total sync error', e.message))
    }

    // "0 12 * * SUN" — domingo: atualiza sozinho a cópia da grade de salas do
    // site de horários (semana atual + a seguinte).
    if (event.cron === '0 12 * * SUN') {
      await runRoomScheduleSync(env)
        .then(r => console.log(`Room schedule sync ok: ${r.rows} linhas`))
        .catch(e => console.error('Room schedule sync error', e.message))
    }
  }
}
