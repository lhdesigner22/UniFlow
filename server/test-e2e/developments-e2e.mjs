// E2E: Gestão → Desenvolvimentos (vitrine dos sistemas, com logo).
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/developments-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col'), ana: await tok('d-ti-ana'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let r = await call('admin', 'POST', '/api/developments', { name: 'UniFlow', purpose: 'Quadros, chamados e gestão da TI.', url: 'uniflow.serfecaf.workers.dev', logo: PNG })
expect('Super Admin cadastra', r.s, 200)
expect('...link ganha https://', r.j?.url, 'https://uniflow.serfecaf.workers.dev')
expect('...logo guardada', r.j?.logo, PNG)
expect('...situação padrão "producao"', r.j?.status, 'producao')
const uniflow = r.j?.id

expect('logo SVG recusada', (await call('admin', 'POST', '/api/developments', { name: 'x', logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).s, 400)
expect('link javascript: recusado', (await call('admin', 'POST', '/api/developments', { name: 'x', url: 'javascript:alert(1)' })).s, 400)
expect('sem nome recusado', (await call('admin', 'POST', '/api/developments', { name: '  ' })).s, 400)
expect('situação inválida recusada', (await call('admin', 'POST', '/api/developments', { name: 'x', status: 'hack' })).s, 400)

r = await call('ana', 'POST', '/api/developments', { name: 'Robô de relatórios', status: 'desenvolvimento' })
expect('Analista (Gestão=edit) cadastra', r.s, 200)
const robo = r.j?.id

expect('Colaborador (Gestão=none) não vê', (await call('colab', 'GET', '/api/developments')).s, 403)
expect('Auditor lê', (await call('aud', 'GET', '/api/developments')).s, 200)
expect('Auditor não cadastra', (await call('aud', 'POST', '/api/developments', { name: 'x' })).s, 403)
expect('Analista não edita o do Super Admin', (await call('ana', 'PUT', `/api/developments/${uniflow}`, { name: 'hack' })).s, 403)
expect('Analista edita o próprio', (await call('ana', 'PUT', `/api/developments/${robo}`, { purpose: 'Gera o relatório mensal.' })).j?.purpose, 'Gera o relatório mensal.')

r = await call('admin', 'GET', '/api/developments?menu=1')
expect('menu: só id e nome (sem logo)', JSON.stringify(Object.keys(r.j?.[0] || {}).sort()), '["id","name"]')
expect('menu: na ordem de cadastro', (r.j || []).map(d => d.name).join(','), 'UniFlow,Robô de relatórios')

expect('Super Admin exclui', (await call('admin', 'DELETE', `/api/developments/${robo}`)).s, 200)
expect('...e some da lista', (await call('admin', 'GET', '/api/developments')).j?.length, 1)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
