// E2E: importação em lote + duplicatas (ignorando sala) + limpeza em segundo plano,
// contra o Worker LOCAL (wrangler dev --test-scheduled) e um GLPI de mentira.
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799', MOCK = 'http://127.0.0.1:8798'
const token = await new SignJWT({ id: 'u-test', name: 'Teste Live', email: 'teste@colegioser.com', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode('testsecret'))
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const api = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }
const mock = async p => (await fetch(MOCK + p)).json()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tick = () => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`) // dispara o cron de 1 min

let allOk = true
const check = (n, c, extra = '') => { allOk &&= !!c; console.log(`${c ? 'OK   ' : 'FALHA'}  ${n}${extra ? '  — ' + extra : ''}`) }
const events = async () => (await api('GET', '/api/events?from=2026-01-01&to=2028-12-31')).body

await mock('/__reset')
const first = await mock('/__stats')
console.log(`GLPI de mentira: ${first.tickets.length} chamados na fila\n`)

// ── 1) Importação em lote (limite por rodada) ────────────────────────────
let r = await api('POST', '/api/admin/glpi/sync-now')
check('sync-now respondeu', r.status === 200, JSON.stringify(r.body))
let st = await mock('/__stats')
check('1ª rodada baixou NO MÁXIMO 30 chamados (não os 69)', st.gets <= 30 && st.gets > 0, `GETs=${st.gets}`)
check('sobrou fila (remaining > 0)', r.body.remaining > 0, `remaining=${r.body.remaining}`)

// o cron de 1 min continua sozinho até zerar
for (let i = 0; i < 6; i++) { await tick(); await sleep(1200) }
r = await api('POST', '/api/admin/glpi/sync-now')
check('depois do cron, nada mais faltando', r.body.remaining === 0, JSON.stringify(r.body))
await sleep(500)

// ── 2) Agenda: 1 evento por feriado/evento (sem repetir) ────────────────
let ev = await events()
const glpiEvents = ev.filter(e => /Importado do chamado GLPI/.test(e.description || ''))
const byTitle = t => glpiEvents.filter(e => e.title.toLowerCase().includes(t))
check('"Ano Novo - Feriado": 65 chamados em DUAS levas de horário (06:00 e 07:00) viraram 1 evento na Agenda', byTitle('ano novo').length === 1, `eventos=${byTitle('ano novo').length}`)
check('"Sexta-Feira Santa": 3 chamados com títulos diferentes viraram 1 evento', byTitle('sexta-feira santa').length === 1, `eventos=${byTitle('sexta-feira santa').length}`)
check('"Workshop Único" em datas diferentes continuam 2 eventos', byTitle('workshop').length === 2)
check('"Aula Magna" em horas diferentes continuam 2 eventos', byTitle('aula magna').length === 2)
const anoNovo = byTitle('ano novo')[0]
check('evento do feriado lista as salas somadas na descrição', /Salas \(65\):/.test(anoNovo?.description || ''), (anoNovo?.description || '').slice(0, 90))
check('chamado ilegível foi pra "não reconhecidos"', (await api('GET', '/api/admin/glpi/unparsed')).body.length === 1)

// ── 3) Prévia das duplicatas ─────────────────────────────────────────────
let pv = (await api('GET', '/api/admin/glpi/duplicates')).body
check('prévia: 64 (Ano Novo) + 2 (Sexta-Feira Santa) = 66 a solucionar', pv.to_solve === 66, `to_solve=${pv.to_solve}`)

// ── 4) Botão "Limpar duplicatas" → 1º lote + segundo plano ──────────────
await mock('/__stats').then(s => s) // zera? (mantém contadores, só medimos diferença)
const solBefore = (await mock('/__stats')).solutions.length
r = await api('POST', '/api/admin/glpi/resolve-duplicates')
check('resolve-duplicates respondeu', r.status === 200, JSON.stringify({ solved: r.body.solved, remaining: r.body.remaining, background: r.body.background }))
check('1º lote solucionou no máximo 18', r.body.solved <= 18 && r.body.solved > 0)
check('sobrou fila → segundo plano ligado', r.body.background === true && r.body.remaining > 0)

for (let i = 0; i < 8; i++) { await tick(); await sleep(1500) }
st = await mock('/__stats')
const solved = st.solutions.length - solBefore
check('segundo plano terminou: 66 chamados solucionados no GLPI', solved === 66, `solucionados=${solved}`)
check('texto da solução aponta o chamado que fica', st.solutions.every(s => /^Chamado duplicado\. Tratado no chamado #\d+\.$/.test(s.content)), st.solutions[0]?.content)
const stillOpen = st.tickets.filter(t => t.status === 17).length
check('no GLPI sobram abertos só os que devem ficar (8: 1+1+2+2 + ilegível... )', stillOpen === 1 + 1 + 2 + 2 + 1, `abertos=${stillOpen}`)

pv = (await api('GET', '/api/admin/glpi/duplicates')).body
check('prévia final: nada a solucionar e flag desligada', pv.to_solve === 0 && pv.background === false, JSON.stringify({ to_solve: pv.to_solve, background: pv.background }))
ev = (await events()).filter(e => /Importado do chamado GLPI/.test(e.description || ''))
check('Agenda final: 1+1+2+2 = 6 eventos', ev.length === 6, `eventos=${ev.length}`)

// ── 5) Novo chamado repetido depois: não vira evento, entra na fila ─────
await fetch(MOCK + '/__reset') // 69 de novo (só pra gerar repetidos novos); DB local já tem os 6 eventos
r = await api('POST', '/api/admin/glpi/sync-now')
for (let i = 0; i < 6; i++) { await tick(); await sleep(1000) }
ev = (await events()).filter(e => /Importado do chamado GLPI/.test(e.description || ''))
check('repetidos novos não criaram eventos novos na Agenda', ev.length <= 7, `eventos=${ev.length}`)

console.log(allOk ? '\nTUDO OK' : '\nHÁ FALHAS')
process.exit(allOk ? 0 : 1)
