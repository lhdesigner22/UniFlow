// E2E: Gestão → Cases de Sucesso (vitrine das entregas da TI para a diretoria).
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/success-cases-e2e.mjs
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

let r = await call('admin', 'GET', '/api/success-cases')
expect('lista: os 12 cases de 2026 da migração', r.j?.cases?.length, 12)
expect('...ano padrão = mais recente', r.j?.year, 2026)
expect('...na ordem (1º = Wi-Fi)', r.j?.cases?.[0]?.id, 'case-2026-wifi')
expect('...catracas: servidor local', r.j?.cases?.find(c => c.id === 'case-2026-catracas')?.title, 'Servidor das catracas na UniFECAF')

r = await call('admin', 'GET', '/api/success-cases/stats?year=2026')
expect('stats: números ao vivo', r.s, 200)
expect('...módulos do UniFlow', r.j?.uniflow_modules, 13)
expect('...empréstimos é número', typeof r.j?.loans_year, 'number')

r = await call('ana', 'POST', '/api/success-cases', { title: 'Novo laboratório', pillar: 'operacao', result_value: '40', result_label: 'computadores novos', completed_on: '2026-08', year: 2026 })
expect('Analista (Gestão=edit) cadastra', r.s, 200)
expect('...vai pro fim da ordem', r.j?.order_index, 12)
const novo = r.j?.id

expect('pilar inválido recusado', (await call('admin', 'POST', '/api/success-cases', { title: 'x', pillar: 'hack' })).s, 400)
expect('mês inválido recusado', (await call('admin', 'POST', '/api/success-cases', { title: 'x', completed_on: '2026-13' })).s, 400)
expect('número ao vivo inválido recusado', (await call('admin', 'POST', '/api/success-cases', { title: 'x', live_metric: 'senha' })).s, 400)
expect('sem título recusado', (await call('admin', 'POST', '/api/success-cases', { title: ' ' })).s, 400)

expect('Colaborador (Gestão=none) não vê', (await call('colab', 'GET', '/api/success-cases')).s, 403)
expect('Auditor lê', (await call('aud', 'GET', '/api/success-cases')).s, 200)
expect('Auditor não cadastra', (await call('aud', 'POST', '/api/success-cases', { title: 'x' })).s, 403)

expect('editar mantém o resto', (await call('admin', 'PUT', `/api/success-cases/${novo}`, { status: 'piloto' })).j?.result_value, '40')

// Save financeiro
r = await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_value: 1250.555, saving_period: 'mensal', saving_note: 'Licença antiga' })
expect('save: valor com 2 casas', r.j?.saving_value, 1250.56)
expect('save: período mensal', r.j?.saving_period, 'mensal')
expect('save: como calculamos', r.j?.saving_note, 'Licença antiga')
expect('save: editar outra coisa mantém o save', (await call('admin', 'PUT', `/api/success-cases/${novo}`, { headline: 'x' })).j?.saving_value, 1250.56)
r = await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_value: 900 })
expect('save sem período mantém o período', r.j?.saving_period, 'mensal')
expect('save negativo recusado', (await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_value: -5 })).s, 400)
expect('save texto recusado', (await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_value: 'abc' })).s, 400)
expect('período inválido recusado', (await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_period: 'semanal' })).s, 400)
r = await call('admin', 'POST', '/api/success-cases', { title: 'Com save', saving_value: 5000 })
expect('save novo sem período = anual', r.j?.saving_period, 'anual')
await call('admin', 'DELETE', `/api/success-cases/${r.j?.id}`)
r = await call('admin', 'PUT', `/api/success-cases/${novo}`, { saving_value: null })
expect('remover o save limpa valor e período', `${r.j?.saving_value}|${r.j?.saving_period}`, 'null|null')
expect('Auditor não muda o save', (await call('aud', 'PUT', `/api/success-cases/${novo}`, { saving_value: 1 })).s, 403)

r = await call('admin', 'POST', `/api/success-cases/${novo}/photos`, { data: PNG, thumb: PNG, caption: 'Depois' })
expect('foto enviada', r.s, 200)
const photo = r.j?.id
expect('foto SVG recusada', (await call('admin', 'POST', `/api/success-cases/${novo}/photos`, { data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', thumb: PNG })).s, 400)
r = await call('admin', 'GET', `/api/success-cases/${novo}`)
expect('detalhe traz a miniatura', r.j?.photos?.[0]?.caption, 'Depois')
expect('...sem a foto grande', r.j?.photos?.[0]?.data, undefined)
expect('foto grande sob demanda', (await call('admin', 'GET', `/api/success-cases/${novo}/photos/${photo}`)).j?.data, PNG)
expect('lista traz a capa', (await call('admin', 'GET', '/api/success-cases')).j?.cases?.find(c => c.id === novo)?.cover, PNG)

r = await call('admin', 'GET', '/api/success-cases')
const ids = r.j.cases.map(c => c.id)
await call('admin', 'PUT', '/api/success-cases/order', { ids: [novo, ...ids.filter(id => id !== novo)] })
expect('reordenar: novo vira o 1º', (await call('admin', 'GET', '/api/success-cases')).j?.cases?.[0]?.id, novo)

expect('outro ano', (await call('admin', 'POST', '/api/success-cases', { title: 'Plano 2027', year: 2027 })).s, 200)
r = await call('admin', 'GET', '/api/success-cases')
expect('...ano padrão vira 2027', r.j?.year, 2027)
expect('...anos disponíveis', JSON.stringify(r.j?.years), '[2027,2026]')

expect('excluir', (await call('admin', 'DELETE', `/api/success-cases/${novo}`)).s, 200)
expect('...fotos saem junto', (await call('admin', 'GET', `/api/success-cases/${novo}/photos/${photo}`)).s, 404)
expect('...2026 volta a 12', (await call('admin', 'GET', '/api/success-cases?year=2026')).j?.cases?.length, 12)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
