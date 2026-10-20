// Cliente HTTP minimalista pra API REST do GLPI — usado pra importar
// automaticamente pra Agenda os chamados da fila "Eventos" (status
// configurável, padrão 17), restritos a uma entidade (padrão "SERVICE DESK",
// id 4). Credenciais em `env.GLPI_BASE_URL` / `GLPI_APP_TOKEN` /
// `GLPI_USER_TOKEN` — configuradas via `wrangler secret put`, nunca aqui.
//
// Filtragem é feita pelo endpoint de busca oficial do GLPI
// (`/apirest.php/search/Ticket`), não localmente — importante porque os
// chamados relevantes (fila "Eventos") são normalmente recentes, e uma busca
// que só percorre a coleção do começo (IDs mais antigos) nunca chegaria
// neles num GLPI com muito histórico. Os IDs de campo usados abaixo (12 =
// status, 80 = entidade) são os campos "core" do GLPI e foram confirmados
// contra a instalação real (retornou os 25 chamados esperados, incluindo o
// #14492 usado como caso de teste).
//
// Depois da busca, cada chamado encontrado é buscado individualmente via
// `GET /Ticket/{id}` pra pegar os campos completos (`content`/`name`) com
// nomes confirmados — evita depender do ID de campo de busca da descrição,
// que não foi validado e pode variar. Com o volume atual (~25 chamados na
// fila), isso significa uma chamada de busca + uma por chamado a cada
// execução do cron (15 min) — aceitável; se o volume crescer muito no
// futuro, dá pra otimizar filtrando também por `date_mod` na busca.

async function glpiInitSession(env) {
  const res = await fetch(`${env.GLPI_BASE_URL}/apirest.php/initSession`, {
    method: 'GET',
    headers: {
      'App-Token': env.GLPI_APP_TOKEN,
      Authorization: `user_token ${env.GLPI_USER_TOKEN}`,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GLPI initSession respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.session_token
}

async function glpiKillSession(env, sessionToken) {
  try {
    await fetch(`${env.GLPI_BASE_URL}/apirest.php/killSession`, {
      method: 'GET',
      headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken },
    })
  } catch { /* best-effort — não bloqueia o sync por um erro aqui */ }
}

// Busca os IDs dos chamados que batem com status + entidade, paginando se
// precisar (teto de segurança: até 20 páginas de 250 = 5000 chamados).
async function glpiSearchTicketIds(env, sessionToken, { statusId, entityId }) {
  const pageSize = 250
  const maxPages = 20
  const ids = []
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize
    const end = start + pageSize - 1
    const url = `${env.GLPI_BASE_URL}/apirest.php/search/Ticket`
      + `?criteria[0][field]=12&criteria[0][searchtype]=equals&criteria[0][value]=${statusId}`
      + `&criteria[1][link]=AND&criteria[1][field]=80&criteria[1][searchtype]=equals&criteria[1][value]=${entityId}`
      + `&forcedisplay[0]=2&range=${start}-${end}`
    const res = await fetch(url, { headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GLPI search/Ticket respondeu ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json()
    const rows = data.data || []
    for (const row of rows) ids.push(row['2'])
    if (rows.length < pageSize) break // última página
  }
  return ids
}

async function glpiGetTicket(env, sessionToken, id) {
  const res = await fetch(`${env.GLPI_BASE_URL}/apirest.php/Ticket/${id}`, {
    headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GLPI Ticket/${id} respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Retorna os chamados completos (com `content`/`name`) que batem com status
// + entidade configurados. Um chamado que falha ao buscar individualmente
// (ex: apagado/sem permissão entre a busca e este GET) é PULADO, não aborta
// o lote inteiro — antes, um único chamado com erro travava a sincronização
// de Eventos inteira, e como o `scheduled()` do Worker não isolava esse
// erro dos passos seguintes, isso chegou a impedir o envio dos resumos
// diários/semanais (que rodam no mesmo tick) por vários dias seguidos.
//
// Limite de subrequests (Workers Free: 50 por execução, e CADA consulta ao D1
// conta como uma): a busca devolve só os números; `skipIds` tira os que a
// Agenda já conhece ANTES de baixar o conteúdo (1 chamada ao GLPI por chamado),
// e `max` limita quantos são baixados nesta rodada. O que sobrar fica pra
// próxima rodada (`remaining`). Sem isso, uma fila grande (ex: 280 chamados)
// gastava toda a cota relendo chamados já importados e NUNCA chegava nos novos.
export async function glpiFetchEventTickets(env, { statusId, entityId, skipIds = null, retryLastIds = null, max = Infinity }) {
  const sessionToken = await glpiInitSession(env)
  try {
    const allIds = (await glpiSearchTicketIds(env, sessionToken, { statusId, entityId })).map(Number)
    let wanted = skipIds ? allIds.filter(id => !skipIds.has(id)) : allIds
    // Chamados que já falharam no reconhecimento (e são retentados a cada rodada) vão pro
    // FIM da fila, pra não ocuparem as vagas da rodada à frente dos chamados novos.
    if (retryLastIds?.size) wanted = [...wanted.filter(id => !retryLastIds.has(id)), ...wanted.filter(id => retryLastIds.has(id))]
    const batchIds = wanted.slice(0, max)
    const tickets = []
    for (const id of batchIds) {
      try {
        tickets.push(await glpiGetTicket(env, sessionToken, id))
      } catch (e) {
        console.error(`GLPI evento: falha ao buscar chamado #${id}, pulando`, e.message)
      }
    }
    return { tickets, totalInQueue: allIds.length, remaining: wanted.length - batchIds.length }
  } finally {
    await glpiKillSession(env, sessionToken)
  }
}

// Marca chamados como Solucionado no GLPI. Usa `ITILSolution` (é o jeito
// "de verdade" do GLPI: cria a solução e o próprio GLPI muda o status) em vez
// de só trocar o campo status. Antes de mexer, confere que o chamado ainda
// está no status esperado (fila "Eventos") — se alguém já tratou/moveu o
// chamado no GLPI, não sobrescrevemos. Retorna um resultado por chamado:
// 'solved' | 'skipped' (status mudou) | 'error' (com `message`).
// Cada chamado custa 2 subrequests (GET + POST) — quem chama limita o lote.
// Passe `ids` + `solutionText` (mesmo texto pra todos) OU `items`
// [{ id, solutionText }] quando cada chamado leva um texto próprio.
export async function glpiSolveTickets(env, { ids, items, expectedStatusId, solutionText }) {
  const sessionToken = await glpiInitSession(env)
  const headers = { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken, 'Content-Type': 'application/json' }
  const results = []
  const list = items || ids.map(id => ({ id, solutionText }))
  try {
    for (const { id, solutionText } of list) {
      try {
        const ticket = await glpiGetTicket(env, sessionToken, id)
        if (Number(ticket.status) !== Number(expectedStatusId)) {
          results.push({ id, result: 'skipped', status: ticket.status })
          continue
        }
        const res = await fetch(`${env.GLPI_BASE_URL}/apirest.php/ITILSolution`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ input: { itemtype: 'Ticket', items_id: id, content: solutionText } }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          results.push({ id, result: 'error', message: `GLPI respondeu ${res.status}: ${body.slice(0, 200)}` })
          // 401/403 = o token não tem permissão de escrita — inútil insistir nos próximos.
          if (res.status === 401 || res.status === 403) break
          continue
        }
        results.push({ id, result: 'solved' })
      } catch (e) {
        // 404 no GET = chamado apagado/na lixeira ou fora do alcance do token:
        // não adianta tentar de novo, então não é "erro" (que ficaria preso na fila).
        if (/respondeu 404/.test(e.message)) results.push({ id, result: 'not_found' })
        else results.push({ id, result: 'error', message: e.message })
      }
    }
  } finally {
    await glpiKillSession(env, sessionToken)
  }
  return results
}

// ── Backlog de chamados ──────────────────────────────────────────────────
// Inspirado no "Dashboard de Helpdesk GLPI" (projeto irmão), mas com uma
// diferença de arquitetura importante: aquele projeto roda no NAVEGADOR
// (sem limite de CPU), e busca literalmente TODO o histórico de chamados
// pra filtrar no cliente. Aqui rodamos dentro de um Cloudflare Worker (cron
// de 15 min) com limite de CPU por execução — buscar todo o histórico (esta
// instalação já passa de 10.000 chamados) não é seguro nesse ambiente.
//
// Estratégia (confirmada com o time do projeto irmão, que já bateu nessa
// pedra antes): usar `/search/Ticket` pros CHAMADOS (filtrado só pelos
// abertos, então bem menor que o histórico completo), mas resolver o
// TÉCNICO via `Ticket_User` — o campo "nome do técnico" no forcedisplay do
// /search/Ticket não é confiável nessa instalação (já tentamos: veio número
// solto, não nome). `Ticket_User` também é filtrado só por `type=2`
// (vínculo "atribuído a" — 1=solicitante, 3=observador), cortando boa parte
// do volume de antemão.
// Status "aberto" desta instalação: tudo exceto 5=Resolvido, 6=Fechado.
// Filtramos só por status na busca ao GLPI (OR simples entre os códigos —
// já confirmado funcionando: devolveu o total esperado num teste ao vivo).
// A entidade (SERVICE DESK) é filtrada DEPOIS, no nosso próprio código, a
// partir do campo 80 (texto "Entidade raiz > SERVICE DESK") que pedimos no
// forcedisplay — evita depender de agrupar criteria com AND+OR no GLPI, que
// se mostrou frágil nesta instalação (tentamos `criteria[N][criteria][...]`
// pra combinar entidade E (status OU status OU...) e a contagem saiu muito
// abaixo do esperado, sinal de que o agrupamento não funcionou como devia).
export const OPEN_STATUS_CODES = [1, 2, 3, 4, 10, 13, 14, 15, 16, 17]
// Todos os status conhecidos nesta instalação, incluindo Resolvido(5) e
// Fechado(6) — usado pelo "Total de Chamados" (histórico completo da
// entidade, não só o backlog em aberto).
export const ALL_STATUS_CODES = [1, 2, 3, 4, 5, 6, 10, 13, 14, 15, 16, 17]

async function glpiSearchTicketsByStatus(env, sessionToken, entityName, statusCodes) {
  const pageSize = 500
  const maxPages = 30 // até 15.000 chamados — folga generosa sobre o esperado
  const criteria = statusCodes
    .map((code, i) => i === 0
      ? `criteria[0][field]=12&criteria[0][searchtype]=equals&criteria[0][value]=${code}`
      : `criteria[${i}][link]=OR&criteria[${i}][field]=12&criteria[${i}][searchtype]=equals&criteria[${i}][value]=${code}`)
    .join('&')
  const forcedisplay = ['2', '1', '12', '3', '15', '19', '80']
    .map((field, i) => `forcedisplay[${i}]=${field}`).join('&')

  const rows = []
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize
    const end = start + pageSize - 1
    const url = `${env.GLPI_BASE_URL}/apirest.php/search/Ticket?${criteria}&${forcedisplay}&range=${start}-${end}`
    const res = await fetch(url, { headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GLPI search/Ticket respondeu ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json()
    const batch = data.data || []
    rows.push(...batch)
    if (batch.length < pageSize) break // última página
  }
  return entityName ? rows.filter(r => String(r['80'] || '').includes(entityName)) : rows
}

// Vínculos técnico↔chamado — só `type=2` ("atribuído a"), reduz bastante o
// volume em relação ao Ticket_User completo (que também tem solicitante e
// observador). Retorna pares brutos {ticketId, userId} — nome é resolvido
// depois via `/User`.
// O motor de busca (/search/Ticket_User) nessa instalação só expõe 3 campos
// pesquisáveis (ID, Chamado, Usuário) — não tem "tipo" (solicitante/
// técnico/observador) como search option, então não dá pra filtrar
// type=2 no servidor por ali (confirmado via /listSearchOptions/Ticket_User).
// A coleção simples (/Ticket_User) traz o campo `type` de verdade, mas exige
// baixar a tabela inteira pra filtrar no código — sem alternativa mais leve
// disponível nessa instalação.
async function glpiFetchTechnicianLinks(env, sessionToken) {
  const links = await glpiFetchPaginated(env, sessionToken, 'Ticket_User', { expandDropdowns: false, pageSize: 2000, maxPages: 20 })
  return links
    .filter(l => Number(l.type) === 2 && l.tickets_id && l.users_id)
    .map(l => ({ ticketId: l.tickets_id, userId: l.users_id }))
}

async function glpiFetchPaginated(env, sessionToken, itemtype, { expandDropdowns, pageSize, maxPages }) {
  const all = []
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize
    const end = start + pageSize - 1
    const url = `${env.GLPI_BASE_URL}/apirest.php/${itemtype}?expand_dropdowns=${expandDropdowns}&get_hateoas=false&range=${start}-${end}`
    const res = await fetch(url, { headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GLPI ${itemtype} respondeu ${res.status}: ${body.slice(0, 300)}`)
    }
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

// Nome de exibição do técnico: prioriza Nome + Sobrenome (`firstname` +
// `realname`, nomenclatura do GLPI) em vez do login (`name`) — nessa
// instalação, boa parte dos usuários só tem o login preenchido de forma
// legível (ex: "PAULO"), mas outros têm login no formato "usuario.sobrenome"
// (ex: "luiz.sanchez"), que fica ruim de exibir num gráfico.
function glpiUserDisplayName(u, fallback) {
  const full = [u.firstname, u.realname].filter(Boolean).join(' ').trim()
  return full || u.name || fallback
}

async function glpiListSearchOptions(env, sessionToken, itemtype) {
  const res = await fetch(`${env.GLPI_BASE_URL}/apirest.php/listSearchOptions/${itemtype}`, {
    headers: { 'App-Token': env.GLPI_APP_TOKEN, 'Session-Token': sessionToken },
  })
  if (!res.ok) return null
  return res.json()
}

// Só os chamados (sem tocar em Ticket_User/User) — a parte realmente barata
// (1 busca, no máximo algumas páginas). Usado tanto pelo backlog (roda a
// cada 1 min) quanto pelo total (a cada 15 min): cada um passa seu próprio
// `statusCodes`. `entityName` é um trecho de texto (ex: "SERVICE DESK")
// comparado contra o nome completo da entidade do chamado.
//
// IMPORTANTE (histórico de CPU): até aqui, resolver o técnico de cada
// chamado exigia baixar a coleção INTEIRA de Ticket_User + User do GLPI
// (várias páginas de até 2000/1000 registros) — caro o bastante pra rodar a
// cada 15 min, mas problemático demais pra rodar a cada 1 min (que foi
// quando o consumo de CPU do Worker disparou). A solução: essa função NÃO
// resolve técnico nenhum — só devolve os chamados. Quem precisa do nome do
// técnico usa `glpiFetchTechnicianCache` (pesado, só roda a cada 15 min) via
// o cache em D1 — ver `glpiTechCache.js`.
export async function glpiFetchTickets(env, { entityName, statusCodes }) {
  const sessionToken = await glpiInitSession(env)
  try {
    const searchRows = await glpiSearchTicketsByStatus(env, sessionToken, entityName, statusCodes)
    return searchRows.map(row => ({
      id: Number(row['2']),
      name: row['1'],
      status: row['12'],
      priority: row['3'],
      date_creation: row['15'],
      date_mod: row['19'],
      entity: row['80'], // "Entidade raiz > SERVICE DESK" — usado pra separar por departamento
    }))
  } finally {
    await glpiKillSession(env, sessionToken)
  }
}

// Cadastro de entidades do GLPI (o que o token enxerga), como caminho completo
// ("Entidade raiz > GENTE E GESTÃO") — mesmo formato do campo Entidade dos
// chamados. Alimenta a lista de escolha do Admin → Departamentos: antes ela
// vinha só dos chamados baixados, então entidade sem chamado aberto sumia.
export async function glpiFetchEntities(env) {
  const sessionToken = await glpiInitSession(env)
  try {
    const rows = await glpiFetchPaginated(env, sessionToken, 'Entity', { expandDropdowns: false, pageSize: 1000, maxPages: 3 })
    return [...new Set(rows.map(e => String(e.completename || e.name || '').trim()).filter(Boolean))]
  } finally {
    await glpiKillSession(env, sessionToken)
  }
}

// A parte cara: TODOS os vínculos técnico↔chamado (type=2) + TODOS os
// usuários, pra resolver nomes. Deliberadamente sem filtrar por conjunto de
// chamados (o cache é reaproveitado tanto pelo backlog quanto pelo total,
// que têm conjuntos de chamados diferentes) — só roda a cada 15 min.
export async function glpiFetchTechnicianCache(env) {
  const sessionToken = await glpiInitSession(env)
  try {
    const [techLinks, users] = await Promise.all([
      glpiFetchTechnicianLinks(env, sessionToken),
      glpiFetchPaginated(env, sessionToken, 'User', { expandDropdowns: false, pageSize: 1000, maxPages: 10 }),
    ])
    const userNameById = {}
    for (const u of users) userNameById[u.id] = glpiUserDisplayName(u, `Usuário #${u.id}`)
    return { links: techLinks, userNameById }
  } finally {
    await glpiKillSession(env, sessionToken)
  }
}

// Função pura (sem rede) — cruza os chamados de um snapshot com o cache de
// técnicos/usuários já resolvido, filtrando os vínculos pro conjunto de
// chamados dado. Chamados sem vínculo, ou cujo técnico ainda não apareceu no
// cache (usuário muito recente), simplesmente não aparecem — o próximo
// refresh do cache (até 15 min) resolve.
export function resolveAssignees(tickets, techCache) {
  const { links, userNameById } = techCache || { links: [], userNameById: {} }
  const ticketIds = new Set(tickets.map(t => t.id))
  const techIdsByTicket = {}
  for (const { ticketId, userId } of links) {
    const tid = Number(ticketId)
    if (!ticketIds.has(tid)) continue
    ;(techIdsByTicket[tid] ||= new Set()).add(userId)
  }
  const assigneeNamesByTicket = {}
  for (const ticketId of Object.keys(techIdsByTicket)) {
    assigneeNamesByTicket[ticketId] = [...techIdsByTicket[ticketId]].map(uid => userNameById[uid] || `Usuário #${uid}`)
  }
  return assigneeNamesByTicket
}
