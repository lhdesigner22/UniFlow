// E2E: etiquetas dos quadros — a mesma etiqueta em vários cartões e a lista do
// quadro (cartão fechado) trazendo as etiquetas de cada cartão.
//   cd server && node test-e2e/node-server.mjs
//   node test-e2e/labels-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const T = await new SignJWT({ id: 'u-test', name: 'u-test', email: 'u-test@colegioser.com', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

const board = (await call('POST', '/api/boards', { name: 'Etiquetas' })).j
const full = (await call('GET', `/api/boards/${board.id}`)).j
const col = full.columns[0].id
const a = (await call('POST', `/api/boards/${board.id}/cards`, { title: 'Julia', column_id: col })).j
const b = (await call('POST', `/api/boards/${board.id}/cards`, { title: 'Suely', column_id: col })).j
const roxa = (await call('POST', `/api/boards/${board.id}/labels`, { name: 'Onboarding', color: '#8B5CF6' })).j

await call('POST', `/api/boards/${board.id}/cards/${a.id}/labels`, { label_id: roxa.id })
let list = (await call('GET', `/api/boards/${board.id}/cards`)).j
expect('cartão fechado traz a etiqueta', list.find(c => c.id === a.id)?.labels?.[0]?.name, 'Onboarding')
expect('...com a cor', list.find(c => c.id === a.id)?.labels?.[0]?.color, '#8B5CF6')
expect('cartão sem etiqueta = lista vazia', list.find(c => c.id === b.id)?.labels?.length, 0)

await call('POST', `/api/boards/${board.id}/cards/${b.id}/labels`, { label_id: roxa.id })
list = (await call('GET', `/api/boards/${board.id}/cards`)).j
expect('pôr no 2º cartão: o 1º continua com ela', list.find(c => c.id === a.id)?.labels?.length, 1)
expect('...e o 2º também tem', list.find(c => c.id === b.id)?.labels?.length, 1)
expect('cartão aberto (1º) ainda tem', (await call('GET', `/api/boards/${board.id}/cards/${a.id}`)).j?.labels?.length, 1)

await call('DELETE', `/api/boards/${board.id}/cards/${b.id}/labels/${roxa.id}`)
list = (await call('GET', `/api/boards/${board.id}/cards`)).j
expect('tirar do 2º não tira do 1º', list.find(c => c.id === a.id)?.labels?.length, 1)
expect('...e sai do 2º', list.find(c => c.id === b.id)?.labels?.length, 0)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
