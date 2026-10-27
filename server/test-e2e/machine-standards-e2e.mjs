// E2E: Base de Conhecimento → Padronização de máquinas.
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/machine-standards-e2e.mjs
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

let r = await call('admin', 'GET', '/api/machine-standards')
expect('os 5 perfis da apresentação', r.j?.length, 5)
expect('cargos primeiro, em ordem', r.j?.map(m => m.kind).join(','), 'cargo,cargo,cargo,setor,setor')
expect('estagiário: i3 e 8 GB', `${r.j?.[0]?.cpu} · ${r.j?.[0]?.ram}`, 'Intel Core i3 · 8 GB')
expect('marketing audiovisual: placa de vídeo', r.j?.find(m => m.id === 'ms-marketing-audiovisual')?.extra, 'Placa de vídeo dedicada')

expect('Colaborador (KB=ver) lê', (await call('colab', 'GET', '/api/machine-standards')).s, 200)
expect('Colaborador não cria', (await call('colab', 'POST', '/api/machine-standards', { name: 'x' })).s, 403)
expect('Colaborador não edita', (await call('colab', 'PUT', '/api/machine-standards/ms-estagiario', { ram: '64 GB' })).s, 403)

r = await call('ana', 'POST', '/api/machine-standards', { kind: 'setor', name: 'Design', cpu: 'Intel Core i7', ram: '32 GB', color: '#8B5CF6', icon: '🎨' })
expect('Analista (KB=editar) cria', r.s, 200)
const design = r.j?.id
expect('...registra quem atualizou', r.j?.updated_by_name, 'd-ti-ana')
expect('cor inválida recusada', (await call('admin', 'POST', '/api/machine-standards', { name: 'x', color: 'red;' })).s, 400)
expect('tipo inválido recusado', (await call('admin', 'POST', '/api/machine-standards', { name: 'x', kind: 'hack' })).s, 400)
expect('sem nome recusado', (await call('admin', 'POST', '/api/machine-standards', { name: ' ' })).s, 400)
r = await call('admin', 'PUT', '/api/machine-standards/ms-auxiliar', { ram: '16 GB' })
expect('editar a memória mantém o resto', `${r.j?.cpu} · ${r.j?.ram}`, 'Intel Core i5 · 16 GB')
expect('excluir', (await call('admin', 'DELETE', `/api/machine-standards/${design}`)).s, 200)
expect('...volta a 5', (await call('admin', 'GET', '/api/machine-standards')).j?.length, 5)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
