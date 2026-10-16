// Cache do vínculo técnico↔chamado + nomes de usuário do GLPI. Existe
// especificamente pra separar a parte CARA da sincronização (baixar TODA a
// coleção de Ticket_User + User) da parte BARATA (buscar só os chamados em
// aberto) — a primeira só precisa rodar a cada 15 min (quem é técnico de um
// chamado não muda de minuto a minuto), a segunda pode rodar a cada 1 min
// sem custo real. Ver nota em glpiClient.js (`glpiFetchTechnicianCache`).
import { glpiFetchTechnicianCache } from './glpiClient.js'

export async function refreshGlpiTechCache(env, db) {
  if (!env.GLPI_BASE_URL || !env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    return { skipped: true, reason: 'GLPI não configurado' }
  }
  const cache = await glpiFetchTechnicianCache(env)
  await db.prepare(`
    INSERT INTO glpi_tech_cache (id, data, updated_at) VALUES ('current', ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(JSON.stringify(cache))
  return { links: cache.links.length, users: Object.keys(cache.userNameById).length }
}

export async function loadGlpiTechCache(db) {
  const row = await db.prepare("SELECT data FROM glpi_tech_cache WHERE id = 'current'").get()
  return row ? JSON.parse(row.data) : { links: [], userNameById: {} }
}
