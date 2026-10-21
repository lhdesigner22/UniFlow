// E2E dos cargos: um usuário de cada cargo batendo nas APIs (Worker local).
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tokenFor = async id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tokenFor('u-test'), colab: await tokenFor('u-col'), analista: await tokenFor('u-ana'), auditor: await tokenFor('u-aud'), semcargo: await tokenFor('u-sem') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = Array.isArray(want) ? want.includes(got) : got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${got}${pass ? '' : ', esperado ' + want})`) }

// ── /auth/me traz cargo e permissões ─────────────────────────────────────
let r = await call('colab', 'GET', '/api/auth/me')
expect('Colaborador: /auth/me responde', r.s, 200)
expect('/auth/me traz o nome do cargo', r.j?.role_name, 'Colaborador')
expect('/auth/me traz permissões por módulo', r.j?.permissions?.agenda, 'view')
expect('/auth/me traz o escopo', r.j?.scope, 'department')
r = await call('admin', 'GET', '/api/auth/me')
expect('Super Admin: escopo "all" e tudo "edit"', r.j?.scope === 'all' && Object.values(r.j?.permissions || {}).every(v => v === 'edit') ? 'ok' : JSON.stringify(r.j), 'ok')
r = await call('semcargo', 'GET', '/api/auth/me')
expect('Quem entra sem cargo vira Colaborador', r.j?.role_name, 'Colaborador')

// ── Colaborador: agenda só VÊ, métricas/chamados NÃO VÊ ─────────────────
expect('Colab: GET /events (agenda=view)', (await call('colab', 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).s, 200)
expect('Colab: POST /events bloqueado (só visualiza)', (await call('colab', 'POST', '/api/events', { title: 'x', event_date: '2026-12-01' })).s, 403)
expect('Colab: GET /metrics/summary bloqueado (sem acesso)', (await call('colab', 'GET', '/api/metrics/summary?from=2026-01-01&to=2026-12-31')).s, 403)
expect('Colab: GET /glpi-backlog bloqueado', (await call('colab', 'GET', '/api/glpi-backlog')).s, 403)
expect('Colab: GET /printers liberado (view)', (await call('colab', 'GET', '/api/printers')).s, 200)
expect('Colab: POST /equipment-loans bloqueado (loans=view)', (await call('colab', 'POST', '/api/equipment-loans', { requester_name: 'a', equipment_model: 'b', building: 'sede' })).s, 403)
expect('Colab: GET /equipment-loans liberado', (await call('colab', 'GET', '/api/equipment-loans')).s, 200)
expect('Colab: GET /boards liberado (boards=edit)', (await call('colab', 'GET', '/api/boards')).s, 200)
expect('Colab: GET /kb liberado (kb=view)', (await call('colab', 'GET', '/api/kb')).s, 200)
expect('Colab: GET /kb?category=gestao bloqueado (gestao=none)', (await call('colab', 'GET', '/api/kb?category=gestao')).s, 403)
expect('Colab: POST /kb bloqueado (kb=view)', (await call('colab', 'POST', '/api/kb', { title: 't', category: 'outro' })).s, 403)
expect('Colab: POST /kb de GESTÃO bloqueado (corpo diz category=gestao)', (await call('colab', 'POST', '/api/kb', { title: 't', category: 'gestao' })).s, 403)
expect('Colab: /users/search (sem módulo) liberado', (await call('colab', 'GET', '/api/users/search')).s, 200)
expect('Colab: /admin/roles bloqueado (só Super Admin)', (await call('colab', 'GET', '/api/admin/roles')).s, 403)

// ── Analista = acesso de antes (tudo edit) ──────────────────────────────
expect('Analista: POST /events liberado', (await call('analista', 'POST', '/api/events', { title: 'Evento do analista', event_date: '2026-12-01' })).s, 200)
expect('Analista: GET /metrics/summary liberado', (await call('analista', 'GET', '/api/metrics/summary?from=2026-01-01&to=2026-12-31')).s, [200])
expect('Analista: GET /glpi-backlog liberado', (await call('analista', 'GET', '/api/glpi-backlog')).s, [200, 404, 500])
expect('Analista: POST /equipment-loans liberado', (await call('analista', 'POST', '/api/equipment-loans', { requester_name: 'a', equipment_model: 'b', building: 'sede' })).s, 200)
expect('Analista: GET /kb?category=gestao liberado', (await call('analista', 'GET', '/api/kb?category=gestao')).s, 200)

// ── Auditor: lê tudo, só escreve na Base de Conhecimento ─────────────────
expect('Auditor: GET /equipment-loans', (await call('auditor', 'GET', '/api/equipment-loans')).s, 200)
expect('Auditor: POST /events bloqueado', (await call('auditor', 'POST', '/api/events', { title: 'x', event_date: '2026-12-01' })).s, 403)
expect('Auditor: POST /kb liberado', (await call('auditor', 'POST', '/api/kb', { title: 'Artigo do auditor', category: 'outro' })).s, 200)

// ── Super Admin gerencia cargos ──────────────────────────────────────────
r = await call('admin', 'GET', '/api/admin/roles')
expect('Admin: lista cargos', r.s, 200)
expect('lista traz os 5 cargos nativos', r.j?.roles?.length >= 5 ? 'ok' : r.j?.roles?.length, 'ok')
expect('lista traz os 13 módulos', r.j?.modules?.length, 13)

r = await call('admin', 'POST', '/api/admin/roles', { name: 'Recepção', scope: 'department', permissions: { agenda: 'edit', loans: 'view', bogus: 'edit', printers: 'xyz' } })
expect('Admin: cria cargo "Recepção"', r.s, 200)
const roleId = r.j?.id
expect('cargo criado é perfil técnico "user"', r.j?.system_role, 'user')
expect('módulo inventado é descartado, nível inválido vira none', (() => { const p = JSON.parse(r.j?.permissions || '{}'); return !('bogus' in p) && p.printers === 'none' && p.agenda === 'edit' })() ? 'ok' : r.j?.permissions, 'ok')
expect('nome repetido é recusado (409)', (await call('admin', 'POST', '/api/admin/roles', { name: 'Recepção' })).s, 409)

expect('Admin: edita permissões do cargo', (await call('admin', 'PUT', `/api/admin/roles/${roleId}`, { permissions: { agenda: 'view', loans: 'edit' } })).s, 200)
expect('Admin: NÃO altera o cargo Super Admin (travado)', (await call('admin', 'PUT', '/api/admin/roles/role-super-admin', { name: 'X' })).s, 400)
expect('Admin: NÃO altera o cargo Auditor (travado)', (await call('admin', 'PUT', '/api/admin/roles/role-auditor', { scope: 'department' })).s, 400)
expect('Admin: NÃO apaga cargo travado', (await call('admin', 'DELETE', '/api/admin/roles/role-super-admin')).s, 400)
expect('Admin: NÃO apaga o cargo padrão Colaborador', (await call('admin', 'DELETE', '/api/admin/roles/role-colaborador')).s, 400)

// atribui o cargo novo a alguém e o acesso muda NA HORA
expect('Admin: atribui o cargo novo ao usuário "semcargo"', (await call('admin', 'PUT', '/api/admin/users/u-sem', { role_id: roleId })).s, 200)
expect('usuário com cargo novo: loans=edit agora vale (POST)', (await call('semcargo', 'POST', '/api/equipment-loans', { requester_name: 'a', equipment_model: 'b', building: 'sede' })).s, 200)
expect('usuário com cargo novo: agenda=view (POST bloqueado)', (await call('semcargo', 'POST', '/api/events', { title: 'x', event_date: '2026-12-01' })).s, 403)

// Admin muda as permissões do cargo → vale imediatamente (sem novo login)
await call('admin', 'PUT', `/api/admin/roles/${roleId}`, { permissions: { agenda: 'none', loans: 'none' } })
expect('permissão retirada vale na hora (loans → 403)', (await call('semcargo', 'GET', '/api/equipment-loans')).s, 403)

// apagar cargo em uso → quem tinha volta pra Colaborador
expect('Admin: apaga o cargo em uso', (await call('admin', 'DELETE', `/api/admin/roles/${roleId}`)).s, 200)
r = await call('semcargo', 'GET', '/api/auth/me')
expect('quem tinha o cargo apagado volta pra Colaborador', r.j?.role_name, 'Colaborador')

// não deixa o sistema sem Super Admin
const demote = await call('admin', 'PUT', '/api/admin/users/u-test', { role_id: 'role-colaborador' })
expect('Admin NÃO se rebaixa se for o único Super Admin', demote.s, 400)

console.log(ok ? '\nTUDO OK' : '\nHÁ FALHAS')
process.exit(ok ? 0 : 1)
