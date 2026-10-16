// E2E da separação por departamento (Worker local, GLPI não é usado aqui).
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tokenFor = async id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const WHO = ['u-test', 'd-ti-ana', 'd-rh-ana', 'd-rh-col', 'd-nodept', 'u-aud']
const T = Object.fromEntries(await Promise.all(WHO.map(async w => [w, await tokenFor(w)])))
const call = async (who, method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const check = (name, cond, extra = '') => { ok &&= !!cond; console.log(`${cond ? 'OK   ' : 'FALHA'}  ${name}${extra ? '  — ' + extra : ''}`) }
const titles = r => (Array.isArray(r.j) ? r.j : []).map(x => x.title || x.requester_name || x.item_name || x.model || x.name || x.company_name || x.provider || x.user_name)
const has = (r, t) => titles(r).includes(t)

const TI = 'd-ti', RH = 'd-rh'
const ev = '/api/events?from=2030-01-01&to=2030-12-31'

// ── Agenda ───────────────────────────────────────────────────────────────
let r = await call('d-ti-ana', 'POST', '/api/events', { title: 'Evento TI', event_date: '2030-05-01' })
check('TI cria evento', r.s === 200 && r.j.department_id === TI, `dept=${r.j?.department_id}`)
const evTi = r.j?.id
r = await call('d-rh-ana', 'POST', '/api/events', { title: 'Evento RH', event_date: '2030-05-01', department_id: TI /* tentativa de burlar */ })
check('RH não consegue criar evento "no TI" (departamento é forçado ao dele)', r.s === 200 && r.j.department_id === RH, `dept=${r.j?.department_id}`)
const evRh = r.j?.id
r = await call('u-test', 'POST', '/api/events', { title: 'Evento Geral', event_date: '2030-05-01', department_id: '' })
check('Super Admin cria evento GERAL (sem departamento)', r.s === 200 && r.j.department_id === null)
const evGeral = r.j?.id

check('TI vê o dele + Geral, não o do RH', (r = await call('d-ti-ana', 'GET', ev), has(r, 'Evento TI') && has(r, 'Evento Geral') && !has(r, 'Evento RH')), titles(r).join(' | '))
check('RH vê o dele + Geral, não o do TI', (r = await call('d-rh-ana', 'GET', ev), has(r, 'Evento RH') && has(r, 'Evento Geral') && !has(r, 'Evento TI')), titles(r).join(' | '))
check('Sem departamento vê só o Geral', (r = await call('d-nodept', 'GET', ev), has(r, 'Evento Geral') && !has(r, 'Evento TI') && !has(r, 'Evento RH')), titles(r).join(' | '))
check('Super Admin vê tudo', (r = await call('u-test', 'GET', ev), has(r, 'Evento TI') && has(r, 'Evento RH') && has(r, 'Evento Geral')))
check('Auditor vê tudo (todos os departamentos)', (r = await call('u-aud', 'GET', ev), has(r, 'Evento TI') && has(r, 'Evento RH')))

// "ver como departamento": só estreita, e só vale pra quem enxerga tudo
check('Super Admin "vendo como RH": RH + Geral, sem TI', (r = await call('u-test', 'GET', ev, null, { 'X-Department-View': RH }), has(r, 'Evento RH') && has(r, 'Evento Geral') && !has(r, 'Evento TI')), titles(r).join(' | '))
check('Super Admin "vendo só Geral"', (r = await call('u-test', 'GET', ev, null, { 'X-Department-View': 'geral' }), has(r, 'Evento Geral') && !has(r, 'Evento TI') && !has(r, 'Evento RH')))
check('Cabeçalho "ver como" NÃO amplia o acesso de quem é do TI', (r = await call('d-ti-ana', 'GET', ev, null, { 'X-Department-View': RH }), has(r, 'Evento TI') && !has(r, 'Evento RH')), titles(r).join(' | '))
check('Cabeçalho "ver como" NÃO deixa o RH ver o TI', (r = await call('d-rh-ana', 'GET', ev, null, { 'X-Department-View': 'all' }), !has(r, 'Evento TI')))

// alterar/apagar o de outro departamento = "não existe"
check('RH não edita evento do TI (404)', (await call('d-rh-ana', 'PUT', `/api/events/${evTi}`, { title: 'hack' })).s === 404)
check('RH não apaga evento do TI (404)', (await call('d-rh-ana', 'DELETE', `/api/events/${evTi}`)).s === 404)
check('TI não edita evento GERAL (só quem vê tudo)', (await call('d-ti-ana', 'PUT', `/api/events/${evGeral}`, { title: 'hack' })).s === 403)
check('Super Admin edita evento do RH', (await call('u-test', 'PUT', `/api/events/${evRh}`, { title: 'Evento RH' })).s === 200)
r = await call('u-test', 'PUT', `/api/events/${evRh}`, { department_id: TI })
check('Super Admin pode MOVER evento de departamento (RH → TI)', r.s === 200 && r.j.department_id === TI)
await call('u-test', 'PUT', `/api/events/${evRh}`, { department_id: RH })
r = await call('d-ti-ana', 'PUT', `/api/events/${evTi}`, { title: 'Evento TI', department_id: RH })
check('TI NÃO consegue mover o próprio evento pra outro departamento', r.s === 200 && r.j.department_id === TI, `dept=${r.j?.department_id}`)

// ── Empréstimos ──────────────────────────────────────────────────────────
r = await call('d-ti-ana', 'POST', '/api/equipment-loans', { requester_name: 'Pessoa TI', equipment_model: 'Chromebook', building: 'sede' })
const loanTi = r.j?.id
await call('d-rh-ana', 'POST', '/api/equipment-loans', { requester_name: 'Pessoa RH', equipment_model: 'Projetor', building: 'sede' })
check('Empréstimos: TI não vê os do RH', (r = await call('d-ti-ana', 'GET', '/api/equipment-loans'), has(r, 'Pessoa TI') && !has(r, 'Pessoa RH')), titles(r).join(' | '))
check('Empréstimos: RH não vê os do TI', (r = await call('d-rh-ana', 'GET', '/api/equipment-loans'), has(r, 'Pessoa RH') && !has(r, 'Pessoa TI')))
check('Empréstimos: RH não muda a situação de empréstimo do TI (404)', (await call('d-rh-ana', 'POST', `/api/equipment-loans/${loanTi}/status`, { status: 'devolvido' })).s === 404)
check('Empréstimos: RH não lê mensagens de empréstimo do TI', (r = await call('d-rh-ana', 'GET', `/api/equipment-loans/${loanTi}/messages`), Array.isArray(r.j) && r.j.length === 0))
check('Empréstimos: CSV do RH só tem as linhas dele', await (async () => { const rr = await fetch(`${BASE}/api/equipment-loans/export`, { headers: { Authorization: `Bearer ${T['d-rh-ana']}` } }); const t = await rr.text(); return t.includes('Pessoa RH') && !t.includes('Pessoa TI') })())

// ── Solicitações de Compra: participante sempre enxerga ─────────────────
r = await call('d-ti-ana', 'POST', '/api/purchase-requests', { item_name: 'Compra TI', approver_ids: ['d-rh-ana'] })
check('Compra criada no TI, aprovador é do RH', r.s === 200 && r.j.department_id === TI, `status=${r.s}`)
const prTi = r.j?.id
await call('d-rh-col', 'POST', '/api/purchase-requests', { item_name: 'Compra RH', approver_ids: ['d-rh-ana'] })
check('Aprovador de OUTRO departamento enxerga a compra que precisa decidir', (r = await call('d-rh-ana', 'GET', '/api/purchase-requests'), has(r, 'Compra TI') && has(r, 'Compra RH')), titles(r).join(' | '))
check('Quem não participa nem é do departamento NÃO vê a compra do TI', (r = await call('d-rh-col', 'GET', '/api/purchase-requests'), has(r, 'Compra RH') && !has(r, 'Compra TI')), titles(r).join(' | '))
check('Aprovador de outro departamento consegue decidir', (await call('d-rh-ana', 'POST', `/api/purchase-requests/${prTi}/decide`, { decision: 'approved' })).s === 200)
check('RH (não participante) não muda status da compra do TI (404)', (await call('d-rh-col', 'POST', `/api/purchase-requests/${prTi}/status`, { status: 'comprado' })).s === 404)

// ── Base de Conhecimento ─────────────────────────────────────────────────
await call('d-ti-ana', 'POST', '/api/kb', { title: 'Artigo TI', category: 'outro' })
await call('d-rh-ana', 'POST', '/api/kb', { title: 'Artigo RH', category: 'outro' })
check('KB: TI só vê artigos do TI', (r = await call('d-ti-ana', 'GET', '/api/kb'), has(r, 'Artigo TI') && !has(r, 'Artigo RH')), titles(r).join(' | '))
check('KB: RH só vê artigos do RH', (r = await call('d-rh-ana', 'GET', '/api/kb'), has(r, 'Artigo RH') && !has(r, 'Artigo TI')))
check('KB: Super Admin vê os dois', (r = await call('u-test', 'GET', '/api/kb'), has(r, 'Artigo RH') && has(r, 'Artigo TI')))

// ── Gestão (documentos) usa a mesma tabela ───────────────────────────────
await call('d-ti-ana', 'POST', '/api/kb', { title: 'Doc Gestão TI', category: 'gestao' })
check('Gestão: RH não vê o documento do TI', (r = await call('d-rh-ana', 'GET', '/api/kb?category=gestao'), !has(r, 'Doc Gestão TI')))
check('Gestão: TI vê o próprio', (r = await call('d-ti-ana', 'GET', '/api/kb?category=gestao'), has(r, 'Doc Gestão TI')))

// ── Impressoras / Empresas / Parceiros / Links (criação só Super Admin) ──
await call('u-test', 'POST', '/api/printers', { location: 'sede', model: 'Impressora do TI', department_id: TI })
await call('u-test', 'POST', '/api/printers', { location: 'sede', model: 'Impressora do RH', department_id: RH })
await call('u-test', 'POST', '/api/printers', { location: 'sede', model: 'Impressora Geral', department_id: '' })
check('Impressoras: TI vê TI + Geral, não RH', (r = await call('d-ti-ana', 'GET', '/api/printers'), has(r, 'Impressora do TI') && has(r, 'Impressora Geral') && !has(r, 'Impressora do RH')), titles(r).join(' | '))
check('Impressoras: RH vê RH + Geral, não TI', (r = await call('d-rh-ana', 'GET', '/api/printers'), has(r, 'Impressora do RH') && has(r, 'Impressora Geral') && !has(r, 'Impressora do TI')))

await call('u-test', 'POST', '/api/partners', { company_name: 'Parceiro TI', department_id: TI })
await call('u-test', 'POST', '/api/partners', { company_name: 'Parceiro RH', department_id: RH })
check('Parceiros separados por departamento', (r = await call('d-rh-ana', 'GET', '/api/partners'), has(r, 'Parceiro RH') && !has(r, 'Parceiro TI')))
await call('u-test', 'POST', '/api/internet-links', { location: 'sede', provider: 'Operadora TI', department_id: TI })
check('Links de internet separados por departamento', (r = await call('d-rh-ana', 'GET', '/api/internet-links'), !has(r, 'Operadora TI')))
await call('u-test', 'POST', '/api/companies', { company: 'unifecaf', name: 'Filial TI', department_id: TI })
await call('u-test', 'POST', '/api/companies', { company: 'unifecaf', name: 'Filial Geral', department_id: '' })
check('Empresas: RH vê só a Geral', (r = await call('d-rh-ana', 'GET', '/api/companies'), has(r, 'Filial Geral') && !has(r, 'Filial TI')), titles(r).join(' | '))

// ── Organograma: um por departamento ────────────────────────────────────
await call('u-test', 'POST', '/api/org-chart', { name: 'Diretor do TI', department_id: TI })
r = await call('u-test', 'POST', '/api/org-chart', { name: 'Diretor do RH', department_id: RH })
const nodeRh = r.j?.id
r = await call('u-test', 'POST', '/api/org-chart', { name: 'Analista do RH', parent_id: nodeRh, department_id: TI /* ignorado: herda do pai */ })
check('Organograma: subordinado herda o departamento do superior', r.j?.department_id === RH, `dept=${r.j?.department_id}`)
check('Organograma: TI vê só o do TI', (r = await call('d-ti-ana', 'GET', '/api/org-chart'), has(r, 'Diretor do TI') && !has(r, 'Diretor do RH') && !has(r, 'Analista do RH')), titles(r).join(' | '))
check('Organograma: RH vê só o do RH', (r = await call('d-rh-ana', 'GET', '/api/org-chart'), has(r, 'Diretor do RH') && !has(r, 'Diretor do TI')))

// ── Time (Desempenho / Jornada): por departamento da PESSOA ──────────────
await call('u-test', 'POST', '/api/team-kudos/members', { user_id: 'd-ti-ana' })
await call('u-test', 'POST', '/api/team-kudos/members', { user_id: 'd-rh-ana' })
check('Desempenho: TI vê só colegas do TI', (r = await call('d-ti-ana', 'GET', '/api/team-kudos/members'), titles(r).length === 1 && titles(r)[0] === 'd-ti-ana'), titles(r).join(' | '))
check('Desempenho: Super Admin vê todos', (r = await call('u-test', 'GET', '/api/team-kudos/members'), titles(r).length === 2))
await call('u-test', 'POST', '/api/journey/members', { user_id: 'd-ti-ana' })
await call('u-test', 'POST', '/api/journey/members', { user_id: 'd-rh-ana' })
check('Jornada: RH vê só colegas do RH', (r = await call('d-rh-ana', 'GET', '/api/journey/members'), r.j?.length === 1 && r.j[0].user_id === 'd-rh-ana'))
check('Jornada: RH não abre a jornada de alguém do TI', (r = await call('d-rh-ana', 'GET', '/api/journey/d-ti-ana'), r.j?.events?.length === 0 && r.j?.story === ''))

// ── Lista pública de departamentos ───────────────────────────────────────
check('Qualquer logado lê a lista de departamentos', (r = await call('d-rh-col', 'GET', '/api/users/departments'), Array.isArray(r.j) && r.j.length >= 2))

console.log(ok ? '\nTUDO OK' : '\nHÁ FALHAS')
process.exit(ok ? 0 : 1)
