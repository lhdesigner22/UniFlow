// E2E: o que cada departamento enxerga (teto por módulo) + cargo padrão de quem
// entra pela primeira vez (login Google de mentira do node-server).
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/dept-modules-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), ana: await tok('d-ti-ana'), rhana: await tok('d-rh-ana') }
const call = async (who, method, path, body) => {
  const auth = T[who] || who
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// Primeiro acesso pelo Google (servidor de teste assina o ID token)
async function googleLogin(email) {
  const { credential } = await (await fetch(`${BASE}/__mock/google-token`, { method: 'POST', body: JSON.stringify({ email }) })).json()
  const r = await fetch(`${BASE}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })
  const j = await r.json()
  return { s: r.status, me: j.token ? (await call(j.token, 'GET', '/api/auth/me')).j : null }
}

// ── Cargo padrão ──
expect('padrão inicial = Colaborador', (await call('admin', 'GET', '/api/admin/roles')).j?.defaultRoleId, 'role-colaborador')
expect('Super Admin não pode ser padrão', (await call('admin', 'PUT', '/api/admin/roles-default', { role_id: 'role-super-admin' })).s, 400)
expect('Auditor não pode ser padrão', (await call('admin', 'PUT', '/api/admin/roles-default', { role_id: 'role-auditor' })).s, 400)
expect('cargo inexistente', (await call('admin', 'PUT', '/api/admin/roles-default', { role_id: 'nada' })).s, 404)
expect('Analista não muda o padrão', (await call('ana', 'PUT', '/api/admin/roles-default', { role_id: 'role-gestor' })).s, 403)
expect('Super Admin define Gestor como padrão', (await call('admin', 'PUT', '/api/admin/roles-default', { role_id: 'role-gestor' })).j?.defaultRoleId, 'role-gestor')

let g = await googleLogin('novo1@fecaf.com.br')
expect('1º acesso entra', g.s, 200)
expect('...com o cargo padrão (Gestor)', g.me?.role_id, 'role-gestor')
g = await googleLogin('u-col@colegioser.com')
expect('quem já existia não muda de cargo', g.me?.role_id, 'role-colaborador')

let r = await call('admin', 'POST', '/api/admin/roles', { name: 'Recepção', permissions: { agenda: 'view' } })
const recepcao = r.j?.id
await call('admin', 'PUT', '/api/admin/roles-default', { role_id: recepcao })
g = await googleLogin('novo2@pro.fecaf.com.br')
expect('cargo criado como padrão vale no 1º acesso', g.me?.role_name, 'Recepção')
expect('...permissões do cargo', g.me?.permissions?.agenda, 'view')
await call('admin', 'DELETE', `/api/admin/roles/${recepcao}`)
expect('apagar o cargo padrão → volta a Colaborador', (await call('admin', 'GET', '/api/admin/roles')).j?.defaultRoleId, 'role-colaborador')
g = await googleLogin('novo3@colegioser.com')
expect('...e quem entra depois vira Colaborador', g.me?.role_id, 'role-colaborador')

// ── O que o departamento enxerga ──
const before = (await call('ana', 'GET', '/api/auth/me')).j?.permissions
expect('Analista do TI edita a Gestão (antes)', before?.gestao, 'edit')
expect('...e a Base de Conhecimento', before?.kb, 'edit')

r = await call('admin', 'PUT', '/api/admin/departments/d-ti', { module_limits: { gestao: 'none', kb: 'view', boards: 'edit', hack: 'none' } })
expect('salva o teto do TI', JSON.stringify(r.j?.module_limits), '{"kb":"view","gestao":"none"}')
expect('lista de departamentos traz o teto', (await call('admin', 'GET', '/api/admin/departments')).j?.find(d => d.id === 'd-ti')?.module_limits?.kb, 'view')

const after = (await call('ana', 'GET', '/api/auth/me')).j?.permissions
expect('TI: Gestão some', after?.gestao, 'none')
expect('TI: Base de Conhecimento só ver', after?.kb, 'view')
expect('TI: Quadros conforme o cargo', after?.boards, before?.boards)
expect('servidor barra a Gestão (Desenvolvimentos)', (await call('ana', 'GET', '/api/developments')).s, 403)
expect('servidor barra a Gestão (Cases de Sucesso)', (await call('ana', 'GET', '/api/success-cases')).s, 403)
expect('KB: ler pode', (await call('ana', 'GET', '/api/kb')).s, 200)
expect('KB: criar não', (await call('ana', 'POST', '/api/kb', { title: 'x', content: 'y' })).s, 403)
expect('outro departamento não é afetado (RH)', (await call('rhana', 'GET', '/api/auth/me')).j?.permissions?.gestao, 'edit')
expect('Super Admin não é afetado', (await call('admin', 'GET', '/api/developments')).s, 200)

r = await call('admin', 'PUT', '/api/admin/departments/d-ti', { module_limits: { gestao: 'edit', kb: 'edit' } })
expect('tudo "conforme o cargo" = sem teto', JSON.stringify(r.j?.module_limits), '{}')
expect('Analista do TI volta a ver a Gestão', (await call('ana', 'GET', '/api/developments')).s, 200)
expect('mudar o nome não apaga o teto', (await call('admin', 'PUT', '/api/admin/departments/d-rh', { module_limits: { loans: 'none' } }), (await call('admin', 'PUT', '/api/admin/departments/d-rh', { name: 'RH' })).j?.module_limits?.loans), 'none')

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
