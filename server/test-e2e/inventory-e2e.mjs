// E2E: Inventário → Brain (/api/inventory/brain). Módulo `inventory`: Analista edita,
// Colaborador não vê, controle desconhecido = 404, sem separação por departamento.
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/inventory-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col'), ana: await tok('d-ti-ana'), rh: await tok('d-rh-ana') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const list = async who => (await call(who, 'GET', '/api/inventory/brain')).j?.items || []

const a = await call('ana', 'POST', '/api/inventory/brain', { holder_name: '  inventory-e2e   Maria  ', sector: 'COMERCIAL POLOS', asset_tag: 8270, notes: 'fone com o JP' })
expect('Analista cadastra kit', a.s, 200)
expect('nome sem espaços sobrando', a.j?.holder_name, 'inventory-e2e Maria')
expect('patrimônio numérico vira texto', a.j?.asset_tag, '8270')
const b = await call('admin', 'POST', '/api/inventory/brain', { holder_name: 'inventory-e2e João', sector: 'ACADEMICO', asset_tag: '8270' })
expect('patrimônio repetido é aceito (a tela avisa)', b.s, 200)
expect('sem responsável = 400', (await call('ana', 'POST', '/api/inventory/brain', { holder_name: ' ' })).s, 400)
expect('controle desconhecido = 404', (await call('ana', 'GET', '/api/inventory/foguete')).s, 404)

expect('Colaborador (sem o módulo) não vê', (await call('colab', 'GET', '/api/inventory/brain')).s, 403)
expect('Colaborador não cadastra', (await call('colab', 'POST', '/api/inventory/brain', { holder_name: 'x' })).s, 403)
const rhSees = (await list('rh')).some(i => i.id === a.j.id)
expect('Analista de outro departamento vê (sem separação)', rhSees, true)

const items = await list('ana')
expect('lista em ordem de nome', items.findIndex(i => i.id === b.j.id) < items.findIndex(i => i.id === a.j.id), true)

const e = await call('rh', 'PUT', `/api/inventory/brain/${a.j.id}`, { holder_name: 'inventory-e2e Maria Souza', notes: '' })
expect('Analista edita', e.j?.holder_name, 'inventory-e2e Maria Souza')
expect('observação vazia vira nula', e.j?.notes, null)
expect('editar mantém o setor', e.j?.sector, 'COMERCIAL POLOS')
expect('editar item inexistente = 404', (await call('ana', 'PUT', '/api/inventory/brain/nao-existe', { holder_name: 'x' })).s, 404)

expect('Analista exclui', (await call('ana', 'DELETE', `/api/inventory/brain/${a.j.id}`)).s, 200)
expect('excluir de novo = 404', (await call('ana', 'DELETE', `/api/inventory/brain/${a.j.id}`)).s, 404)
await call('admin', 'DELETE', `/api/inventory/brain/${b.j.id}`)
expect('limpou os itens de teste', (await list('admin')).some(i => i.holder_name.startsWith('inventory-e2e')), false)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHA')
process.exit(ok ? 0 : 1)
