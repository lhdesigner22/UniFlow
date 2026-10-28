// E2E: Logs de auditoria (Admin → Logs) — Cofre de Senhas com vigilância reforçada,
// alterações em qualquer área, telas abertas, exportação e quem pode ler.
//   cd server && node test-e2e/node-server.mjs   (banco recém-subido: conta linhas)
//   node test-e2e/audit-e2e.mjs
import { SignJWT } from 'jose'

const BASE = process.env.BASE || 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col'), ana: await tok('u-ana'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json', 'User-Agent': 'audit-e2e' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const logs = async (q = '') => (await call('admin', 'GET', `/api/audit?limit=200${q}`)).j?.rows || []
const last = async (action, q = '') => (await logs(q)).find(r => r.action === action)

// ── Cofre ─────────────────────────────────────────────────────────────────
let r = await call('admin', 'POST', '/api/vault', { title: 'Painel do firewall', password: 'S3nh@-secreta', username: 'admin' })
expect('cria item no cofre', r.s, 200)
const entry = r.j?.id
let l = await last('vault.create', '&category=vault')
expect('log: criou item (com o título)', l?.target_label, 'Painel do firewall')

await call('admin', 'GET', '/api/vault')
await call('admin', 'GET', '/api/vault')
const opens = (await logs('&category=vault')).filter(x => x.action === 'vault.open').length
expect('log: abrir o cofre 2x seguidas = 1 registro', opens, 1)

r = await call('admin', 'GET', `/api/vault/${entry}/reveal`)
expect('revela a senha', r.j?.password, 'S3nh@-secreta')
l = await last('vault.reveal')
expect('log: revelou (aviso, com o título)', `${l?.severity} · ${l?.target_label}`, 'warning · Painel do firewall')
expect('log: guarda o navegador', l?.user_agent, 'audit-e2e')
r = await call('admin', 'GET', `/api/vault/${entry}/reveal?purpose=copy`)
expect('log: copiou', (await last('vault.copy'))?.target_id, entry)

await call('admin', 'PUT', `/api/vault/${entry}`, { title: 'Painel do firewall', password: 'nova-senha', notes: 'trocada' })
l = await last('vault.update')
expect('log: editou — só os NOMES dos campos', l?.details, JSON.stringify({ campos: ['senha', 'observações'] }))
const all = JSON.stringify(await logs())
expect('nenhum log contém a senha', all.includes('S3nh@-secreta') || all.includes('nova-senha'), false)

expect('colaborador sem acesso é barrado', (await call('colab', 'GET', '/api/vault')).s, 403)
l = await last('vault.denied')
expect('log: tentativa sem acesso (crítico)', `${l?.severity} · ${l?.user_id}`, 'critical · u-col')
await call('colab', 'GET', '/api/vault')
const notifs = (await call('admin', 'GET', '/api/notifications')).j?.notifications || []
expect('Super Admin avisado 1 vez (não a cada tentativa)', notifs.filter(n => n.title.includes('Tentativa de acesso ao Cofre')).length, 1)

r = await call('admin', 'POST', '/api/vault/access', { user_id: 'u-ana' })
expect('concede acesso', r.s, 200)
expect('log: concedeu acesso (nome da pessoa)', (await last('vault.access_grant'))?.target_label, 'Analista')
expect('analista com acesso não gerencia a lista', (await call('ana', 'GET', '/api/vault/access/list')).s, 403)
expect('...e isso vira log', (await last('vault.denied'))?.target_label, 'a lista de quem acessa o Cofre')

// Rajada: 10 senhas vistas em 10 minutos → alerta pros Super Admins (uma vez).
for (let i = 0; i < 9; i++) await call('ana', 'GET', `/api/vault/${entry}/reveal`)
let burst = ((await call('admin', 'GET', '/api/notifications')).j?.notifications || []).filter(n => n.title.includes('muitas senhas'))
expect('9 revelações: sem alerta ainda', burst.length, 0)
await call('ana', 'GET', `/api/vault/${entry}/reveal?purpose=copy`)
await call('ana', 'GET', `/api/vault/${entry}/reveal`)
burst = ((await call('admin', 'GET', '/api/notifications')).j?.notifications || []).filter(n => n.title.includes('muitas senhas'))
expect('10ª revelação: 1 alerta (a 11ª não repete)', burst.length, 1)

await call('admin', 'DELETE', `/api/vault/access/u-ana`)
expect('log: revogou acesso', (await last('vault.access_revoke'))?.target_id, 'u-ana')
await call('admin', 'DELETE', `/api/vault/${entry}`)
expect('log: excluiu item', (await last('vault.delete'))?.target_label, 'Painel do firewall')

// ── Alterações em qualquer área (middleware) ───────────────────────────────
r = await call('admin', 'POST', '/api/machine-standards', { kind: 'setor', name: 'Teste log', cpu: 'i5', ram: '8 GB' })
await wait(100)
l = await last('machine-standards.create', '&category=change')
expect('log: alteração genérica (criou)', `${l?.method} ${l?.status}`, 'POST 200')
await call('admin', 'DELETE', `/api/machine-standards/${r.j?.id}`)
await wait(100)
expect('log: alteração genérica (excluiu, com id)', (await last('machine-standards.delete'))?.target_id, r.j?.id)
expect('colaborador tenta alterar sem permissão', (await call('colab', 'POST', '/api/machine-standards', { name: 'x' })).s, 403)
await wait(100)
l = await last('machine-standards.create', '&severity=warning')
expect('log: tentativa recusada vira aviso', `${l?.user_id} ${l?.status}`, 'u-col 403')

// ── Telas abertas, saída e quem lê ─────────────────────────────────────────
expect('registra tela aberta', (await call('colab', 'POST', '/api/audit/view', { path: '/backlog' })).s, 200)
expect('Auditor também registra (exceção do só-leitura)', (await call('aud', 'POST', '/api/audit/view', { path: '/agenda' })).s, 200)
expect('caminho inválido recusado', (await call('colab', 'POST', '/api/audit/view', { path: 'http://x' })).s, 400)
await wait(100)
const pages = await logs('&category=page')
expect('log: tela aberta (colaborador → /backlog)', pages.some(p => p.user_id === 'u-col' && p.target_id === '/backlog'), true)
await call('colab', 'POST', '/api/audit/logout')
await wait(100)
expect('log: saiu do sistema', (await last('auth.logout'))?.user_id, 'u-col')

expect('colaborador NÃO lê os logs', (await call('colab', 'GET', '/api/audit')).s, 403)
expect('analista NÃO lê os logs', (await call('ana', 'GET', '/api/audit/summary')).s, 403)
expect('Auditor lê os logs', (await call('aud', 'GET', '/api/audit')).s, 200)
expect('não existe apagar log', (await call('admin', 'DELETE', '/api/audit/1')).s, 404)

r = await call('admin', 'GET', '/api/audit?category=vault&q=firewall')
expect('filtro por texto (Cofre + "firewall")', r.j?.rows?.every(x => x.category === 'vault' && /firewall/i.test(x.target_label || '')) && r.j.rows.length > 0, true)
r = await call('admin', 'GET', '/api/audit?user_id=u-ana&category=vault')
expect('filtro por pessoa', r.j?.rows?.every(x => x.user_id === 'u-ana'), true)
r = await call('admin', 'GET', '/api/audit?limit=5')
const page2 = await call('admin', 'GET', `/api/audit?limit=5&before=${r.j.rows[4].id}`)
expect('paginação: próxima página começa depois', page2.j?.rows?.[0]?.id < r.j.rows[4].id, true)

r = await call('admin', 'GET', '/api/audit/summary')
expect('resumo do Cofre: revelações em 7 dias', r.j?.vault7d?.reveals, 11)
expect('resumo do Cofre: cópias', r.j?.vault7d?.copies, 2)
expect('resumo: quem mais viu senhas', r.j?.topRevealers?.[0]?.user_id, 'u-ana')

r = await call('aud', 'GET', '/api/audit?export=1&category=vault')
expect('exportação devolve as linhas', r.j?.rows?.length > 10, true)
expect('...e a exportação vira log', (await last('audit.export'))?.user_id, 'u-aud')

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
