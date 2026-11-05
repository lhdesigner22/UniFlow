// E2E: Time → Escala (/api/shifts). Módulo `team`: Analista edita, Colaborador só vê;
// pessoas separadas por departamento; vários dias numa chamada; "Repetir mês anterior".
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/shifts-e2e.mjs
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
const month = async (who, m) => (await call(who, 'GET', `/api/shifts?month=${m}`)).j
const statusOf = (data, pid, day) => data?.assignments?.find(a => a.person_id === pid && a.day === day)?.status || null

// pessoas
const rhPerson = await call('admin', 'POST', '/api/shifts/people', { name: 'shifts-e2e RH', department_id: 'd-rh' })
expect('Super Admin cria pessoa no RH', rhPerson.s, 200)
const tiPerson = await call('ana', 'POST', '/api/shifts/people', { name: 'shifts-e2e TI', role_title: 'Auxiliar de T.I.', hours: 'Seg a Sex 13h 22h' })
expect('Analista cria pessoa', tiPerson.s, 200)
expect('pessoa do Analista fica no departamento dele', tiPerson.j?.department_id, 'd-ti')
const tiPerson2 = await call('ana', 'POST', '/api/shifts/people', { name: 'shifts-e2e TI 2' })
expect('sem nome = 400', (await call('ana', 'POST', '/api/shifts/people', { name: '  ' })).s, 400)
expect('Colaborador (Time só ver) não cria pessoa', (await call('colab', 'POST', '/api/shifts/people', { name: 'x' })).s, 403)

const P = tiPerson.j.id, P2 = tiPerson2.j.id, R = rhPerson.j.id
let nov = await month('ana', '2026-11')
expect('Analista TI vê a pessoa do TI', !!nov.people.find(p => p.id === P), true)
expect('Analista TI NÃO vê a pessoa do RH', !!nov.people.find(p => p.id === R), false)
expect('Analista RH vê a pessoa do RH', !!(await month('rh', '2026-11')).people.find(p => p.id === R), true)
expect('Colaborador consulta a escala', (await call('colab', 'GET', '/api/shifts?month=2026-11')).s, 200)
expect('mês inválido = 400', (await call('ana', 'GET', '/api/shifts?month=2026-13')).s, 400)

// dias (vários numa chamada)
const put = await call('ana', 'PUT', '/api/shifts/assignments', { items: [
  { person_id: P, day: '2026-11-07', status: 'SEDE' },
  { person_id: P, day: '2026-11-08', status: 'FOLGA' },
  { person_id: P2, day: '2026-11-07', status: 'CENTRO' },
] })
expect('Analista marca 3 dias de uma vez', put.j?.saved, 3)
nov = await month('ana', '2026-11')
expect('dia 07 = SEDE', statusOf(nov, P, '2026-11-07'), 'SEDE')
expect('dia 08 = FOLGA', statusOf(nov, P, '2026-11-08'), 'FOLGA')
expect('troca SEDE → FERIAS', (await call('ana', 'PUT', '/api/shifts/assignments', { items: [{ person_id: P, day: '2026-11-07', status: 'FERIAS' }] })).s, 200)
expect('dia 07 = FERIAS', statusOf(await month('ana', '2026-11'), P, '2026-11-07'), 'FERIAS')
expect('limpar dia (status vazio)', (await call('ana', 'PUT', '/api/shifts/assignments', { items: [{ person_id: P, day: '2026-11-08', status: null }] })).s, 200)
expect('dia 08 ficou sem marcação', statusOf(await month('ana', '2026-11'), P, '2026-11-08'), null)
expect('situação inválida = 400', (await call('ana', 'PUT', '/api/shifts/assignments', { items: [{ person_id: P, day: '2026-11-09', status: 'PRAIA' }] })).s, 400)
expect('dia inválido = 400', (await call('ana', 'PUT', '/api/shifts/assignments', { items: [{ person_id: P, day: '2026-11-31', status: 'SEDE' }] })).s, 400)
expect('Analista TI não marca pessoa do RH (404)', (await call('ana', 'PUT', '/api/shifts/assignments', { items: [{ person_id: R, day: '2026-11-09', status: 'SEDE' }] })).s, 404)
expect('Colaborador não marca dia', (await call('colab', 'PUT', '/api/shifts/assignments', { items: [{ person_id: P, day: '2026-11-09', status: 'SEDE' }] })).s, 403)
expect('mais de 500 dias numa chamada = 400', (await call('ana', 'PUT', '/api/shifts/assignments', { items: Array.from({ length: 501 }, () => ({ person_id: P, day: '2026-11-01', status: 'SEDE' })) })).s, 400)

// repetir mês anterior: 1º sábado de out (03) → 1º sábado de dez (05); dia já marcado não muda
await call('ana', 'PUT', '/api/shifts/assignments', { items: [
  { person_id: P, day: '2026-11-07', status: 'SEDE' }, // 1º sáb de nov
  { person_id: P, day: '2026-11-14', status: 'CENTRO' }, // 2º sáb de nov
  { person_id: P, day: '2026-12-12', status: 'G5' }, // 2º sáb de dez já marcado
] })
const copy = await call('ana', 'POST', '/api/shifts/copy', { from: '2026-11', to: '2026-12' })
expect('repetir mês anterior responde', copy.s, 200)
const dez = await month('ana', '2026-12')
expect('1º sábado de dez copiou SEDE', statusOf(dez, P, '2026-12-05'), 'SEDE')
expect('2º sábado de dez já marcado continua G5', statusOf(dez, P, '2026-12-12'), 'G5')
expect('1º sábado de dez da outra pessoa copiou CENTRO', statusOf(dez, P2, '2026-12-05'), 'CENTRO')
expect('Analista TI não copia para a pessoa do RH', dez.assignments.some(a => a.person_id === R), false)
expect('Colaborador não repete mês', (await call('colab', 'POST', '/api/shifts/copy', { from: '2026-11', to: '2026-12' })).s, 403)

// ordem
const before = (await month('ana', '2026-11')).people.map(p => p.id)
await call('ana', 'POST', `/api/shifts/people/${P2}/move`, { dir: 'up' })
const after = (await month('ana', '2026-11')).people.map(p => p.id)
expect('subir troca de lugar com o vizinho', after.indexOf(P2) < after.indexOf(P), before.indexOf(P2) > before.indexOf(P))

// editar / excluir
expect('Analista edita a pessoa', (await call('ana', 'PUT', `/api/shifts/people/${P}`, { hours: 'Seg a Sáb' })).j?.hours, 'Seg a Sáb')
expect('Analista RH não edita pessoa do TI (404)', (await call('rh', 'PUT', `/api/shifts/people/${P}`, { name: 'x' })).s, 404)
for (const id of [P, P2]) await call('ana', 'DELETE', `/api/shifts/people/${id}`)
expect('Super Admin exclui a pessoa do RH', (await call('admin', 'DELETE', `/api/shifts/people/${R}`)).s, 200)
const left = await month('admin', '2026-12')
expect('excluir apaga a pessoa', left.people.some(p => p.name.startsWith('shifts-e2e')), false)
expect('excluir apaga os dias da pessoa', left.assignments.some(a => [P, P2, R].includes(a.person_id)), false)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHA')
process.exit(ok ? 0 : 1)
