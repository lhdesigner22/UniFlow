// E2E: interruptor "pausar consultas ao GLPI" (Admin → GLPI).
//   node test-e2e/mock-glpi.mjs  +  node test-e2e/node-server.mjs
//   node test-e2e/glpi-pause-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799', MOCK = 'http://127.0.0.1:8798'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), ti: await tok('d-ti-ana') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const searches = async () => (await (await fetch(MOCK + '/__stats')).json()).searches
const cron = c => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(c)}`)
const allCrons = async () => { for (const c of ['* * * * *', '*/15 * * * *', '5,20,35,50 * * * *', '10,25,40,55 * * * *']) await cron(c) }
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

expect('começa ativo', (await call('admin', 'GET', '/api/admin/glpi/pause')).j?.paused, false)
let before = await searches()
await allCrons()
expect('ativo: os crons consultam o GLPI', (await searches()) > before, true)

expect('Analista não pausa', (await call('ti', 'PUT', '/api/admin/glpi/pause', { paused: true })).s, 403)
let r = await call('admin', 'PUT', '/api/admin/glpi/pause', { paused: true })
expect('Super Admin pausa (guarda quem e quando)', `${r.j?.paused} ${r.j?.by} ${!!r.j?.at}`, 'true Teste Live true')

before = await searches()
await allCrons()
await allCrons()
expect('PAUSADO: nenhum cron consulta o GLPI', (await searches()) - before, 0)
expect('PAUSADO: "Atualizar agora" do Backlog recusa sem chamar o GLPI', (await call('admin', 'POST', '/api/glpi-backlog/refresh')).s, 503)
expect('PAUSADO: "Atualizar agora" do Total recusa', (await call('admin', 'POST', '/api/glpi-total/refresh')).s, 503)
expect('PAUSADO: sincronizar Eventos recusa', (await call('admin', 'POST', '/api/admin/glpi/sync-now')).s, 503)
expect('PAUSADO: solucionar duplicatas recusa', (await call('admin', 'POST', '/api/admin/glpi/resolve-duplicates')).s, 503)
expect('...e nada disso chegou no GLPI', (await searches()) - before, 0)
r = await call('ti', 'GET', '/api/glpi-backlog')
expect('PAUSADO: Backlog continua abrindo, com o aviso', `${r.s} ${r.j?.glpiPaused}`, '200 true')
expect('PAUSADO: Total continua abrindo, com o aviso', (await call('ti', 'GET', '/api/glpi-total')).j?.glpiPaused, true)
expect('PAUSADO: lista de entidades sai do que está guardado', (await call('admin', 'GET', '/api/admin/glpi/entities?refresh=1')).s, 200)

r = await call('admin', 'PUT', '/api/admin/glpi/pause', { paused: false })
expect('religa', r.j?.paused, false)
before = await searches()
await cron('* * * * *')
expect('religado: o Backlog volta a consultar', (await searches()) > before, true)
expect('...e o aviso some', (await call('ti', 'GET', '/api/glpi-backlog')).j?.glpiPaused, false)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
