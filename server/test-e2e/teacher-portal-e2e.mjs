// E2E: Portal do Professor — cargo Professor no 1º login de @pro.fecaf.com.br,
// pedidos de Chromebook (professor pede/cancela, TI confirma/recusa), cada professor
// só vê o que é dele, e abertura de chamado no GLPI (GLPI de mentira na 8798 — esta
// suíte sobe o mock-glpi.mjs sozinha se ele não estiver rodando).
//   cd server && node test-e2e/node-server.mjs
//   node test-e2e/teacher-portal-e2e.mjs
import { SignJWT } from 'jose'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://127.0.0.1:8799'
const GLPI = 'http://127.0.0.1:8798'
const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let mockProc = null
try { await fetch(`${GLPI}/__stats`) } catch {
  mockProc = spawn(process.execPath, [path.join(here, 'mock-glpi.mjs')], { stdio: 'ignore' })
  for (let i = 0; i < 20; i++) { try { await fetch(`${GLPI}/__stats`); break } catch { await sleep(250) } }
}
await fetch(`${GLPI}/__reset`)

const sql = async (q, args = []) => (await fetch(`${BASE}/__mock/sql`, { method: 'POST', body: JSON.stringify({ sql: q, args }) })).json()
await sql(`INSERT OR IGNORE INTO users (id, name, email, password, system_role, role_id) VALUES
  ('u-prof', 'Prof Ana', 'prof@pro.fecaf.com.br', 'x', 'user', 'role-professor'),
  ('u-prof2', 'Prof Beto', 'beto@pro.fecaf.com.br', 'x', 'user', 'role-professor')`)

const key = new TextEncoder().encode('testsecret')
const tok = (id, email) => new SignJWT({ id, name: id, email, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = {
  admin: await tok('u-test', 'teste@colegioser.com'),
  colab: await tok('u-col', 'u-col@colegioser.com'),
  ana: await tok('d-ti-ana', 'dtia@colegioser.com'),
  prof: await tok('u-prof', 'prof@pro.fecaf.com.br'),
  prof2: await tok('u-prof2', 'beto@pro.fecaf.com.br'),
}
const call = async (who, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${T[who] || who}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
const plus = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

try {
  // ── Cargo no 1º login ──
  const { credential } = await (await fetch(`${BASE}/__mock/google-token`, { method: 'POST', body: JSON.stringify({ email: 'novo.prof@pro.fecaf.com.br', name: 'Novo Prof' }) })).json()
  const login = await (await fetch(`${BASE}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })).json()
  const me = (await call(login.token, 'GET', '/api/auth/me')).j
  expect('1º login @pro.fecaf.com.br vira Professor', me?.role_id, 'role-professor')
  expect('Professor usa o portal', me?.permissions?.teacher, 'edit')
  expect('Professor não vê Empréstimos', me?.permissions?.loans, 'none')
  expect('Professor não vê Quadros', me?.permissions?.boards, 'none')
  expect('Professor não abre a lista de empréstimos', (await call('prof', 'GET', '/api/equipment-loans?building=sede')).s, 403)
  expect('Professor não vê os pedidos da TI', (await call('prof', 'GET', '/api/chromebook-requests')).s, 403)
  expect('Analista não usa o portal', (await call('ana', 'GET', '/api/teacher/overview')).s, 403)

  // ── Pedido de Chromebooks ──
  const good = { building: 'g5', room: 'Sala 12', use_date: plus(1), start_time: '19:00', end_time: '21:00', quantity: 25, notes: 'aula de programação' }
  expect('data no passado recusada', (await call('prof', 'POST', '/api/teacher/chromebook-requests', { ...good, use_date: plus(-1) })).s, 400)
  expect('horário invertido recusado', (await call('prof', 'POST', '/api/teacher/chromebook-requests', { ...good, start_time: '21:00', end_time: '19:00' })).s, 400)
  expect('quantidade acima do máximo recusada', (await call('prof', 'POST', '/api/teacher/chromebook-requests', { ...good, quantity: 999 })).s, 400)
  expect('prédio inválido recusado', (await call('prof', 'POST', '/api/teacher/chromebook-requests', { ...good, building: 'xyz' })).s, 400)
  const created = await call('prof', 'POST', '/api/teacher/chromebook-requests', good)
  expect('professor pede Chromebooks', created.s, 201)
  const reqId = created.j?.id
  const second = (await call('prof', 'POST', '/api/teacher/chromebook-requests', { ...good, use_date: plus(2), quantity: 5 })).j?.id

  const bell = await sql("SELECT COUNT(*) AS n FROM notifications WHERE type = 'chromebook' AND user_id = 'd-ti-ana'")
  expect('TI (Empréstimos editar) recebe aviso no sininho', bell[0]?.n >= 1, true)
  const colBell = await sql("SELECT COUNT(*) AS n FROM notifications WHERE type = 'chromebook' AND user_id = 'u-col'")
  expect('quem só vê Empréstimos não recebe aviso', colBell[0]?.n, 0)

  const mine = (await call('prof', 'GET', '/api/teacher/overview')).j
  expect('professor vê os próprios pedidos', mine?.requests?.length, 2)
  const other = (await call('prof2', 'GET', '/api/teacher/overview')).j
  expect('outro professor NÃO vê os pedidos dele', other?.requests?.length, 0)
  expect('outro professor não cancela pedido alheio', (await call('prof2', 'POST', `/api/teacher/chromebook-requests/${reqId}/cancel`)).s, 404)

  // ── TI decide ──
  const list = (await call('colab', 'GET', '/api/chromebook-requests')).j
  expect('quem vê Empréstimos vê os pedidos', list?.requests?.some(r => r.id === reqId), true)
  expect('lista traz o nome do professor', list?.requests?.find(r => r.id === reqId)?.requester_name, 'Prof Ana')
  expect('quem só vê Empréstimos não decide', (await call('colab', 'POST', `/api/chromebook-requests/${reqId}/decision`, { decision: 'aprovada' })).s, 403)
  expect('recusa sem motivo não vale', (await call('ana', 'POST', `/api/chromebook-requests/${second}/decision`, { decision: 'recusada' })).s, 400)
  expect('TI confirma', (await call('ana', 'POST', `/api/chromebook-requests/${reqId}/decision`, { decision: 'aprovada', note: 'Retirar no G5' })).s, 200)
  expect('TI recusa com motivo', (await call('ana', 'POST', `/api/chromebook-requests/${second}/decision`, { decision: 'recusada', note: 'Sem Chromebooks livres' })).s, 200)
  const after = (await call('prof', 'GET', '/api/teacher/overview')).j?.requests || []
  expect('professor vê "aprovada"', after.find(r => r.id === reqId)?.status, 'aprovada')
  expect('professor vê o motivo da recusa', after.find(r => r.id === second)?.decision_note, 'Sem Chromebooks livres')
  const mail = await sql("SELECT COUNT(*) AS n FROM email_outbox WHERE related_type = 'chromebook_request'")
  expect('resposta da TI vai por e-mail', mail[0]?.n >= 2, true)
  const profBell = await sql("SELECT COUNT(*) AS n FROM notifications WHERE type = 'chromebook' AND user_id = 'u-prof'")
  expect('professor recebe a resposta também no sininho', profBell[0]?.n, 2)

  expect('professor cancela o confirmado', (await call('prof', 'POST', `/api/teacher/chromebook-requests/${reqId}/cancel`)).s, 200)
  expect('cancelado não se cancela de novo', (await call('prof', 'POST', `/api/teacher/chromebook-requests/${reqId}/cancel`)).s, 409)
  expect('TI não decide pedido cancelado', (await call('ana', 'POST', `/api/chromebook-requests/${reqId}/decision`, { decision: 'aprovada' })).s, 409)

  // ── Chamado no GLPI ──
  expect('chamado sem descrição recusado', (await call('prof', 'POST', '/api/teacher/tickets', { kind: 'projetor', building: 'g5', room: 'Sala 12', description: 'oi' })).s, 400)
  const t1 = await call('prof', 'POST', '/api/teacher/tickets', { kind: 'projetor', building: 'g5', room: 'Sala 12', description: 'O projetor não liga desde ontem.' })
  expect('professor abre chamado', t1.s, 201)
  const t2 = await call('prof2', 'POST', '/api/teacher/tickets', { kind: 'internet', building: 'sede', room: 'Lab 3', description: 'Wi-Fi cai toda hora na sala.' })
  expect('professor sem usuário no GLPI também abre', t2.s, 201)
  const st = await (await fetch(`${GLPI}/__stats`)).json()
  const c1 = st.created.find(x => x.id === t1.j?.glpi_ticket_id)
  const c2 = st.created.find(x => x.id === t2.j?.glpi_ticket_id)
  expect('chamado criado na entidade SERVICE DESK', c1?.entities_id, 4)
  expect('título diz o tipo e o local', c1?.name, '[Professor] Projetor / TV — G5, Sala 12')
  expect('requerente = usuário do GLPI achado pelo e-mail', c1?._users_id_requester, 777)
  expect('sem usuário no GLPI: e-mail alternativo do requerente', c2?._users_id_requester_notif?.alternative_email?.[0], 'beto@pro.fecaf.com.br')
  expect('descrição vai escapada (sem HTML do professor)', (await call('prof', 'POST', '/api/teacher/tickets', { kind: 'outro', building: 'sede', room: 'x', description: '<script>alert(1)</script> teste' })).s, 201)
  const st2 = await (await fetch(`${GLPI}/__stats`)).json()
  expect('conteúdo escapado no GLPI', st2.created.at(-1)?.content.includes('&lt;script&gt;'), true)

  const tickets = (await call('prof', 'GET', '/api/teacher/overview')).j?.tickets || []
  expect('professor vê os próprios chamados', tickets.length, 2)
  expect('outro professor não vê os chamados dele', ((await call('prof2', 'GET', '/api/teacher/overview')).j?.tickets || []).some(t => t.glpi_ticket_id === t1.j?.glpi_ticket_id), false)
} finally {
  if (mockProc) mockProc.kill()
}

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHA')
process.exit(ok ? 0 : 1)
