// E2E das correções de segurança (out/2026). Roda contra o Worker local
// (wrangler dev ou test-e2e/node-server.mjs) com seed-base.sql + dept-seed.sql.
//   cd server && node test-e2e/security-e2e.mjs
import { SignJWT } from 'jose'
import { normalizeLink, isLinkError, isScriptLink } from '../src/lib/safeUrl.js'
import { escapeCsv } from '../src/lib/csv.js'
import { safeHref } from '../../client/src/utils/safeHref.js'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tokenFor = async (id, tv = 0) => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tokenFor('u-test'), colab: await tokenFor('u-col'), ana: await tokenFor('u-ana'), aud: await tokenFor('u-aud'), ghost: await tokenFor('u-nao-existe'), rhcol: await tokenFor('d-rh-col') }
const call = async (who, method, path, body, extra = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who] || who}`, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.clone().json() } catch {}
  return { s: r.status, j, h: r.headers }
}
let ok = true
const expect = (name, got, want) => { const pass = Array.isArray(want) ? want.includes(got) : got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${got}${pass ? '' : ', esperado ' + want})`) }

// ── Funções puras ────────────────────────────────────────────────────────
expect('link javascript: recusado', isLinkError(normalizeLink('javascript:alert(1)')), true)
expect('link " JaVaScRiPt:" recusado', isLinkError(normalizeLink('  JaVaScRiPt:alert(1)')), true)
expect('link data: recusado', isLinkError(normalizeLink('data:text/html,<script>1</script>')), true)
expect('link sem esquema ganha https', normalizeLink('www.exemplo.com/x'), 'https://www.exemplo.com/x')
expect('link https passa', normalizeLink('https://drive.google.com/a'), 'https://drive.google.com/a')
expect('caminho de rede passa', normalizeLink('\\\\servidor\\impressoras'), '\\\\servidor\\impressoras')
expect('link vazio vira null', normalizeLink('  '), null)
expect('link ausente fica undefined', normalizeLink(undefined), undefined)
expect('cofre: ssh:// passa', isScriptLink('ssh://10.0.0.1'), false)
expect('cofre: javascript com controle antes é barrado', isScriptLink('\u0001java\tscript:alert(1)'), true)
expect('front: safeHref bloqueia javascript:', safeHref('javascript:alert(1)'), undefined)
expect('front: safeHref bloqueia com espaço/tab', safeHref(' \tjavascript:alert(1)'), undefined)
expect('front: safeHref mantém https', safeHref('https://a.b'), 'https://a.b')
expect('CSV: fórmula neutralizada', escapeCsv('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
expect('CSV: @ neutralizado', escapeCsv('@SUM(A1)'), "'@SUM(A1)")
expect('CSV: número negativo intacto', escapeCsv(-5), '-5')
expect('CSV: texto normal intacto', escapeCsv('Mouse USB'), 'Mouse USB')

// ── Cabeçalhos de segurança na API ───────────────────────────────────────
let r = await call('admin', 'GET', '/api/auth/me')
expect('API manda nosniff', r.h.get('x-content-type-options'), 'nosniff')
expect('API manda X-Frame-Options DENY', r.h.get('x-frame-options'), 'DENY')
expect('API manda Cache-Control no-store', r.h.get('cache-control'), 'no-store')
expect('API manda HSTS', !!r.h.get('strict-transport-security'), true)

// ── Login ────────────────────────────────────────────────────────────────
r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'u-col@colegioser.com', password: 'x' }) })
expect('login por senha desativado (410)', r.status, 410)
r = await fetch(BASE + '/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'a.eyJhdWQiOiJvdXRybyJ9.c' }) })
const gj = await r.json()
expect('Google com client id errado: 401', r.status, 401)
expect('...sem expor o client id configurado', /test-client-id/.test(gj.error), false)

// ── Sessão revogável ─────────────────────────────────────────────────────
expect('token de usuário inexistente: 401 na API', (await call('ghost', 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).s, 401)
expect('token de usuário inexistente: 401 nas notificações', (await call('ghost', 'GET', '/api/notifications')).s, 401)
expect('analista antes do "forçar login": 200', (await call('ana', 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).s, 200)
expect('admin força novo login do analista', (await call('admin', 'POST', '/api/admin/users/u-ana/force-relogin')).s, 200)
expect('token antigo do analista: 401 na API', (await call('ana', 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).s, 401)
expect('token antigo do analista: 401 nas notificações', (await call('ana', 'GET', '/api/notifications')).s, 401)
expect('token antigo do analista: 401 no ticket do tempo real', (await call('ana', 'POST', '/api/live/ticket')).s, 401)
T.ana = await tokenFor('u-ana', 1)
expect('token novo do analista (tv=1): 200', (await call('ana', 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).s, 200)

// ── Links (XSS) gravados pelas rotas ─────────────────────────────────────
r = await call('ana', 'POST', '/api/kb', { title: 'xss', category: 'outro', link_url: 'javascript:alert(document.cookie)' })
expect('KB: link javascript: recusado (400)', r.s, 400)
r = await call('ana', 'POST', '/api/kb', { title: 'ok', category: 'outro', link_url: 'drive.google.com/x' })
expect('KB: link sem esquema aceito', r.s, 200)
expect('KB: ...e salvo com https://', r.j?.link_url, 'https://drive.google.com/x')
const kbId = r.j?.id
expect('KB PUT: link javascript: recusado', (await call('ana', 'PUT', `/api/kb/${kbId}`, { link_url: 'javascript:alert(1)' })).s, 400)
r = await call('ana', 'POST', '/api/purchase-requests', { item_name: 'x', approver_ids: ['u-test'], link_url: 'javascript:alert(1)' })
expect('Compras: link javascript: recusado', r.s, 400)
r = await call('admin', 'POST', '/api/printers', { location: 'sede', model: 'HP', link_url: 'javascript:alert(1)' })
expect('Impressoras: link javascript: recusado', r.s, 400)
r = await call('admin', 'POST', '/api/vault', { title: 'x', password: 'p', url: 'javascript:alert(1)' })
expect('Cofre: link javascript: recusado', r.s, 400)
expect('Perfil: foto javascript: recusada', (await call('colab', 'PUT', '/api/auth/me', { name: 'Colab', avatar: 'javascript:alert(1)' })).s, 400)

// ── Portão da Gestão (KB com category=gestao) ────────────────────────────
r = await call('admin', 'POST', '/api/kb', { title: 'Doc da Gestão', category: 'gestao' })
const gestaoId = r.j?.id
expect('admin cria documento da Gestão', r.s, 200)
expect('Colab: anexo da Gestão com ?category=outro → 403', (await call('colab', 'GET', `/api/kb/${gestaoId}/attachment?category=outro`)).s, 403)
r = await call('aud', 'POST', '/api/kb', { title: 'Artigo do auditor', category: 'outro' })
expect('Auditor cria artigo normal (kb=edit)', r.s, 200)
expect('Auditor (gestao=view) não move o artigo pra Gestão', (await call('aud', 'PUT', `/api/kb/${r.j?.id}`, { category: 'gestao' })).s, 403)
expect('Auditor ainda edita o próprio artigo normal', (await call('aud', 'PUT', `/api/kb/${r.j?.id}`, { title: 'Editado' })).s, 200)

// ── Relatório de horas só dos quadros visíveis ───────────────────────────
r = await call('admin', 'POST', '/api/boards', { name: 'Quadro do admin' })
const adminBoard = r.j?.id
expect('admin cria quadro', !!adminBoard, true)
expect('Analista: horas de quadro alheio → 403', (await call('ana', 'GET', `/api/time/summary?boardId=${adminBoard}`)).s, 403)
expect('Analista: export de quadro alheio → 403', (await call('ana', 'GET', `/api/time/export?boardId=${adminBoard}`)).s, 403)
expect('Analista: resumo geral (só os dele) → 200', (await call('ana', 'GET', '/api/time/summary')).s, 200)

// ── Cartões: não mexe em cartão de outro quadro pela URL do seu ──────────
r = await call('ana', 'POST', '/api/boards', { name: 'Quadro B (analista)' })
const boardB = r.j?.id
const colsB = (await call('ana', 'GET', `/api/boards/${boardB}`)).j?.columns || []
r = await call('ana', 'POST', `/api/boards/${boardB}/cards`, { title: 'Cartão B', column_id: colsB[0]?.id })
const cardB = r.j?.id
r = await call('ana', 'POST', `/api/boards/${boardB}/cards/${cardB}/checklist`, { title: 'Item B' })
const itemB = r.j?.id
expect('analista monta quadro B com cartão e checklist', !!(boardB && cardB && itemB), true)
r = await call('colab', 'POST', '/api/boards', { name: 'Quadro A (colab)' })
const boardA = r.j?.id
await call('colab', 'DELETE', `/api/boards/${boardA}/cards/${cardB}/checklist/${itemB}`)
await call('colab', 'PUT', `/api/boards/${boardA}/cards/${cardB}/checklist/${itemB}`, { title: 'hackeado' })
r = await call('ana', 'GET', `/api/boards/${boardB}/cards/${cardB}`)
const item = (r.j?.checklist || []).find(i => i.id === itemB)
expect('item do quadro B continua lá', !!item, true)
expect('...e não foi renomeado', item?.title, 'Item B')

// ── Reordenar colunas (rota que nunca era alcançada) ─────────────────────
r = await call('ana', 'PUT', `/api/boards/${boardB}/columns/reorder`, { columns: colsB.map((c, i) => ({ id: c.id, order_index: colsB.length - i })) })
expect('PUT /columns/reorder responde 200', r.s, 200)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
