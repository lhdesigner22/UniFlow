// E2E: Fluxos → Incidentes Laboratórios (registro, fotos, andamento, permissões).
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/lab-incidents-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), ti: await tok('d-ti-ana'), semdept: await tok('u-ana'), colab: await tok('u-col'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='
const base = { building: 'sede', lab: 'Laboratório 3', category: 'maquina', severity: 'alta', title: 'PC 12 não liga', description: 'Fonte queimando', equipment: 'PC 12 bancada 3', patrimony: '004512', occurred_at: '2026-10-21T14:35', reported_by_name: 'Prof. Carlos', class_info: 'ADS 3º sem', glpi_ticket: '12345' }

// ── Cadastro e validação ─────────────────────────────────────────────────
let r = await call('ti', 'POST', '/api/lab-incidents', base)
expect('Analista do TI registra', r.s, 200)
const inc = r.j
expect('...com todos os campos', `${inc?.lab}|${inc?.severity}|${inc?.occurred_at}|${inc?.status}|${inc?.department_name}`, 'Laboratório 3|alta|2026-10-21T14:35|aberto|TI')
expect('prédio inválido recusado', (await call('ti', 'POST', '/api/lab-incidents', { ...base, building: 'x' })).s, 400)
expect('tipo inválido recusado', (await call('ti', 'POST', '/api/lab-incidents', { ...base, category: 'x' })).s, 400)
expect('sem data/hora recusado', (await call('ti', 'POST', '/api/lab-incidents', { ...base, occurred_at: '' })).s, 400)
expect('sem laboratório recusado', (await call('ti', 'POST', '/api/lab-incidents', { ...base, lab: ' ' })).s, 400)

// ── Permissões por cargo e departamento ──────────────────────────────────
expect('Colaborador (incidents=view) consulta', (await call('colab', 'GET', '/api/lab-incidents')).s, 200)
expect('Colaborador não registra', (await call('colab', 'POST', '/api/lab-incidents', base)).s, 403)
expect('Auditor não registra', (await call('aud', 'POST', '/api/lab-incidents', base)).s, 403)
expect('quem não é do TI não vê o incidente do TI', (await call('semdept', 'GET', `/api/lab-incidents/${inc.id}`)).s, 404)
r = await call('semdept', 'GET', '/api/lab-incidents?building=sede')
expect('...nem na lista', (r.j || []).some(i => i.id === inc.id), false)

// ── Fotos ────────────────────────────────────────────────────────────────
r = await call('ti', 'POST', `/api/lab-incidents/${inc.id}/photos`, { data: JPG, thumb: JPG })
expect('envia foto', r.s, 200)
const photoId = r.j?.id
expect('SVG recusado', (await call('ti', 'POST', `/api/lab-incidents/${inc.id}/photos`, { data: 'data:image/svg+xml;base64,PHN2Zz4=', thumb: JPG })).s, 400)
for (let i = 0; i < 9; i++) await call('ti', 'POST', `/api/lab-incidents/${inc.id}/photos`, { data: JPG, thumb: JPG })
expect('11ª foto recusada (máx. 10)', (await call('ti', 'POST', `/api/lab-incidents/${inc.id}/photos`, { data: JPG, thumb: JPG })).s, 400)
r = await call('ti', 'GET', `/api/lab-incidents/${inc.id}`)
expect('detalhe traz as 10 miniaturas', r.j?.photos?.length, 10)
expect('...sem a foto grande (leve)', r.j?.photos?.[0]?.data, undefined)
expect('foto grande sob demanda', (await call('ti', 'GET', `/api/lab-incidents/${inc.id}/photos/${photoId}`)).j?.data, JPG)
r = await call('ti', 'GET', '/api/lab-incidents?building=sede')
const listed = (r.j || []).find(i => i.id === inc.id)
expect('lista traz capa e contagem de fotos', `${!!listed?.cover} ${listed?.photo_count}`, 'true 10')

// ── Andamento ────────────────────────────────────────────────────────────
expect('menu conta 1 em aberto na SEDE', (await call('ti', 'GET', '/api/lab-incidents/counts')).j?.sede, 1)
r = await call('admin', 'POST', `/api/lab-incidents/${inc.id}/status`, { status: 'resolvido', resolution: 'Fonte trocada' })
expect('Super Admin resolve', `${r.j?.status} ${r.j?.resolution} ${!!r.j?.resolved_at} ${r.j?.resolved_by_name}`, 'resolvido Fonte trocada true Teste Live')
expect('resolvido sai da contagem do menu', (await call('ti', 'GET', '/api/lab-incidents/counts')).j?.sede, undefined)
r = await call('ti', 'POST', `/api/lab-incidents/${inc.id}/status`, { status: 'em_andamento' })
expect('reabrir limpa o "resolvido em"', `${r.j?.status} ${r.j?.resolved_at}`, 'em_andamento null')
expect('situação inválida recusada', (await call('ti', 'POST', `/api/lab-incidents/${inc.id}/status`, { status: 'x' })).s, 400)

// ── Editar / excluir: só quem registrou ou o Super Admin ─────────────────
r = await call('semdept', 'POST', '/api/lab-incidents', { ...base, building: 'g5', title: 'Projetor sem imagem', category: 'projecao' })
const geral = r.j
expect('registro de quem não tem departamento vai pro Geral', geral?.department_id, null)
expect('outro analista não edita o que não registrou', (await call('ti', 'PUT', `/api/lab-incidents/${geral.id}`, { title: 'x' })).s, 403)
expect('autor edita', (await call('semdept', 'PUT', `/api/lab-incidents/${geral.id}`, { title: 'Projetor sem imagem (HDMI)' })).j?.title, 'Projetor sem imagem (HDMI)')
expect('exportação traz os registros', ((await call('admin', 'GET', '/api/lab-incidents/export')).j?.rows || []).length, 2)
expect('autor exclui', (await call('ti', 'DELETE', `/api/lab-incidents/${inc.id}`)).s, 200)
expect('...e as fotos vão junto', (await call('ti', 'GET', `/api/lab-incidents/${inc.id}/photos/${photoId}`)).s, 404)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
