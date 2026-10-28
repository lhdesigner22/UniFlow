// E2E: ticket de download (lib/requestToken.js) no lugar do token de login na URL.
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/download-ticket-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { ...(who ? { Authorization: `Bearer ${T[who]}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const get = async url => (await fetch(BASE + url)).status
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// Os anexos ficam no Google Drive (fora do teste local): numa impressora sem
// driver, 404 "Sem driver anexado" = passou pela autenticação; 401 = barrado.
const printer = (await call('admin', 'POST', '/api/printers', { location: 'sede', model: 'Teste Ticket' })).j
const path = `/api/printers/${printer.id}/attachment`
const PASSOU = 404

let r = await call('admin', 'POST', '/api/auth/download-ticket', { path })
expect('pede ticket do anexo', r.s, 200)
const ticket = r.j?.ticket

expect('baixa com o ticket (passa da autenticação)', await get(`${path}?ticket=${ticket}`), PASSOU)
expect('token de login na URL não vale mais', await get(`${path}?token=${T.admin}`), 401)
expect('ticket não serve pra outra rota', await get(`/api/printers?ticket=${ticket}`), 401)
expect('ticket não serve pra outro anexo', await get(`/api/kb/abc/attachment?ticket=${ticket}`), 401)
expect('ticket não serve para escrever', (await fetch(`${BASE}${path}?ticket=${ticket}`, { method: 'DELETE' })).status, 401)
expect('token de login não passa como ticket', await get(`${path}?ticket=${T.admin}`), 401)
expect('sem login não pede ticket', (await call(null, 'POST', '/api/auth/download-ticket', { path })).s, 401)
expect('caminho que não é anexo é recusado', (await call('admin', 'POST', '/api/auth/download-ticket', { path: '/api/vault/x' })).s, 400)

// Sessão derrubada ("Forçar novo login") invalida o ticket já emitido
r = await call('colab', 'POST', '/api/auth/download-ticket', { path })
const colabTicket = r.j?.ticket
expect('colaborador (Impressoras=ver) pede ticket', r.s, 200)
expect('colaborador baixa (passa da autenticação)', await get(`${path}?ticket=${colabTicket}`), PASSOU)
await call('admin', 'POST', '/api/admin/users/u-col/force-relogin')
expect('depois do "Forçar novo login" o ticket para de valer', await get(`${path}?ticket=${colabTicket}`), 401)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
