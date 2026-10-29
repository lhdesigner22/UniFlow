// E2E: Time → Desempenho — mural "últimos reconhecimentos" (GET /api/team-kudos/recent)
// e a privacidade do ponto de melhoria (moon): nunca no mural; total só para quem
// recebeu e para o Super Admin.
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/kudos-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col'), ana: await tok('d-ti-ana') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// roster: Colab no quadro
let members = (await call('admin', 'GET', '/api/team-kudos/members')).j || []
let col = members.find(m => m.user_id === 'u-col')
if (!col) col = (await call('admin', 'POST', '/api/team-kudos/members', { user_id: 'u-col' })).j
expect('Colab está no quadro', !!col?.id, true)

const star = await call('admin', 'POST', `/api/team-kudos/members/${col.id}/events`, { type: 'star', comment: 'kudos-e2e-estrela' })
const moon = await call('admin', 'POST', `/api/team-kudos/members/${col.id}/events`, { type: 'moon', comment: 'kudos-e2e-lua-secreta' })
expect('Super Admin dá reconhecimento', star.s, 200)
expect('Super Admin dá ponto de melhoria', moon.s, 200)
expect('Colaborador não dá reconhecimento', (await call('colab', 'POST', `/api/team-kudos/members/${col.id}/events`, { type: 'star' })).s, 403)

for (const who of ['admin', 'colab']) {
  const r = await call(who, 'GET', '/api/team-kudos/recent')
  const text = JSON.stringify(r.j)
  expect(`${who}: mural responde`, r.s, 200)
  expect(`${who}: reconhecimento aparece no mural`, text.includes('kudos-e2e-estrela'), true)
  expect(`${who}: ponto de melhoria NUNCA aparece no mural`, text.includes('kudos-e2e-lua-secreta'), false)
}
expect('mural traz no máximo 12', ((await call('admin', 'GET', '/api/team-kudos/recent')).j || []).length <= 12, true)

// total de pontos de melhoria: Colab vê o próprio; quem é de outro departamento não vê
const asCol = ((await call('colab', 'GET', '/api/team-kudos/members')).j || []).find(m => m.user_id === 'u-col')
expect('Colab vê o próprio total de pontos de melhoria', (asCol?.moons ?? 0) >= 1, true)
const asAna = ((await call('ana', 'GET', '/api/team-kudos/members')).j || []).filter(m => m.user_id !== 'd-ti-ana')
expect('Analista não vê o total de pontos de melhoria dos outros', asAna.every(m => m.moons === null), true)

// limpeza
const evs = (await call('admin', 'GET', `/api/team-kudos/members/${col.id}/events`)).j || []
for (const ev of evs.filter(e => String(e.comment || '').startsWith('kudos-e2e'))) await call('admin', 'DELETE', `/api/team-kudos/events/${ev.id}`)
expect('limpou os lançamentos de teste', JSON.stringify((await call('admin', 'GET', '/api/team-kudos/recent')).j).includes('kudos-e2e'), false)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHA')
process.exit(ok ? 0 : 1)
