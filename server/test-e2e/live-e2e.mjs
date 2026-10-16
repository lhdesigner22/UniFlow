// Teste de ponta a ponta do tempo real contra o Worker LOCAL (wrangler dev).
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const token = await new SignJWT({ id: 'u-test' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FALHA'}  ${name} ${extra}`) }

// 1) sem ticket → 401 ; sem Upgrade → 426
const badOpened = await new Promise(res => {
  const bad = new WebSocket('ws://127.0.0.1:8799/api/live/ws?ticket=lixo')
  bad.onopen = () => res(true)
  bad.onerror = () => res(false)
  bad.onclose = () => res(false)
  setTimeout(() => res('timeout'), 5000)
})
check('WebSocket com ticket inválido NÃO conecta', badOpened === false, `resultado=${badOpened}`)
let r = await fetch(`${BASE}/api/live/ws`)
check('sem WebSocket é recusado (426)', r.status === 426, `status=${r.status}`)

// 2) pedir ticket exige login
r = await fetch(`${BASE}/api/live/ticket`, { method: 'POST' })
check('ticket sem login é recusado (401)', r.status === 401, `status=${r.status}`)
r = await fetch(`${BASE}/api/live/ticket`, { method: 'POST', headers: H })
const { ticket } = await r.json()
check('ticket com login é emitido', r.status === 200 && !!ticket)

// 3) o ticket NÃO serve como token de login na API
r = await fetch(`${BASE}/api/printers`, { headers: { Authorization: `Bearer ${ticket}` } })
check('ticket não funciona como token da API (401)', r.status === 401, `status=${r.status}`)

// 4) aparelho A conecta e escuta
const events = []
const ws = new WebSocket(`ws://127.0.0.1:8799/api/live/ws?ticket=${encodeURIComponent(ticket)}`)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws erro')); setTimeout(() => rej(new Error('ws timeout')), 8000) })
ws.onmessage = e => { if (e.data !== 'pong') events.push(JSON.parse(e.data)) }
check('WebSocket conectou', ws.readyState === WebSocket.OPEN)

// ping/pong (auto-response da plataforma)
let pong = false
const pongP = new Promise(res => { const h = e => { if (e.data === 'pong') { pong = true; res() } }; ws.addEventListener('message', h) })
ws.send('ping')
await Promise.race([pongP, new Promise(r => setTimeout(r, 3000))])
check('ping → pong', pong)

const wait = ms => new Promise(r => setTimeout(r, ms))

// 5) aparelho B faz uma alteração → A recebe o aviso do recurso certo, com o id de B
r = await fetch(`${BASE}/api/equipment-loans`, {
  method: 'POST',
  headers: { ...H, 'X-Client-Id': 'aparelho-B' },
  body: JSON.stringify({ requester_name: 'Teste Live', equipment_model: 'Chromebook', building: 'sede' }),
})
check('alteração (POST /equipment-loans) deu certo', r.status === 200, `status=${r.status}`)
await wait(800)
const ev1 = events.find(e => e.r === 'equipment-loans')
check('A recebeu aviso "equipment-loans"', !!ev1, JSON.stringify(ev1 || events))
check('aviso traz o X-Client-Id de quem alterou', ev1?.c === 'aparelho-B')
check('aviso NÃO carrega dados do registro', ev1 && !('requester_name' in ev1) && Object.keys(ev1).every(k => ['r', 'b', 's', 'c', 't'].includes(k)), Object.keys(ev1 || {}).join(','))

// 6) alteração que falha (400) NÃO gera aviso
const before = events.length
r = await fetch(`${BASE}/api/equipment-loans`, { method: 'POST', headers: H, body: JSON.stringify({}) })
await wait(600)
check('alteração recusada (400) não gera aviso', r.status === 400 && events.length === before, `status=${r.status}`)

// 7) GET não gera aviso
const before2 = events.length
await fetch(`${BASE}/api/equipment-loans`, { headers: H })
await wait(500)
check('leitura (GET) não gera aviso', events.length === before2)

// 8) quadro: aviso traz id do quadro e sub-recurso
r = await fetch(`${BASE}/api/boards`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Quadro teste live' }) })
const board = await r.json()
await wait(600)
const evB = events.find(e => e.r === 'boards' && !e.b)
check('criar quadro avisa "boards"', !!evB, `status=${r.status}`)
if (board?.id) {
  const cr = await fetch(`${BASE}/api/boards/${board.id}/columns`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'A fazer' }) })
  await wait(600)
  const evC = events.find(e => e.r === 'boards' && e.b === board.id && e.s === 'columns')
  check('mexer na coluna avisa com id do quadro e s=columns', !!evC, `status=${cr.status} ${JSON.stringify(events.at(-1))}`)
}

// 9) dois aparelhos escutando recebem
const ws2 = new WebSocket(`ws://127.0.0.1:8799/api/live/ws?ticket=${encodeURIComponent((await (await fetch(`${BASE}/api/live/ticket`, { method: 'POST', headers: H })).json()).ticket)}`)
await new Promise(res => { ws2.onopen = res })
const ev2 = []
ws2.onmessage = e => { if (e.data !== 'pong') ev2.push(JSON.parse(e.data)) }
const n1 = events.length
await fetch(`${BASE}/api/equipment-loans`, { method: 'POST', headers: H, body: JSON.stringify({ requester_name: 'Outro', equipment_model: 'Projetor', building: 'g5' }) })
await wait(800)
check('os DOIS aparelhos recebem o aviso', events.length > n1 && ev2.some(e => e.r === 'equipment-loans'))

ws.close(); ws2.close()
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} verificações passaram`)
process.exit(ok === results.length ? 0 : 1)
