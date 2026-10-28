// E2E: senhas de Wi-Fi cifradas (migração 0063), limite de tentativas e aviso
// do cache do Total de Chamados.
//   cd server && RATE_LIMIT=1 node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/secrets-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), colab: await tok('u-col') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { ...(who ? { Authorization: `Bearer ${T[who]}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const sql = async (q, args) => (await fetch(`${BASE}/__mock/sql`, { method: 'POST', body: JSON.stringify({ sql: q, args }) })).json()
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// ── Wi-Fi: texto puro antigo vira cifrado ao abrir a tela ─────────────────
await sql("INSERT INTO vlan_ssids (id, site, ssid, password, order_index) VALUES ('s1', 'matriz', 'REDE-TESTE', 'senha-wifi-123', 0), ('s2', 'matriz', 'SEM-SENHA', NULL, 1)")
let r = await call('admin', 'GET', '/api/vlans?site=matriz')
expect('Super Admin abre as VLANs', r.s, 200)
expect('...rede com senha marcada como tendo senha', r.j?.ssids?.find(x => x.id === 's1')?.has_password, 1)
expect('...rede sem senha continua sem', r.j?.ssids?.find(x => x.id === 's2')?.has_password, 0)
expect('...a listagem não traz a senha', JSON.stringify(r.j).includes('senha-wifi-123'), false)
const [row] = await sql("SELECT password, password_enc, password_iv FROM vlan_ssids WHERE id = 's1'")
expect('texto puro apagado do banco', row.password, null)
expect('senha guardada cifrada', !!row.password_enc && !!row.password_iv && !row.password_enc.includes('senha'), true)
r = await call('admin', 'GET', '/api/vlans/ssids/s1/reveal?purpose=show')
expect('"Mostrar" decifra a senha certa', r.j?.password, 'senha-wifi-123')
expect('...e grava o log antes', (await sql("SELECT COUNT(*) n FROM audit_logs WHERE action = 'vlan.reveal' AND target_id = 's1'"))[0].n, 1)
expect('rede sem senha devolve vazio', (await call('admin', 'GET', '/api/vlans/ssids/s2/reveal')).j?.password, '')
expect('quem não tem acesso ao Cofre não vê', (await call('colab', 'GET', '/api/vlans/ssids/s1/reveal')).s, 403)

// Seed novo em texto puro depois da migração: o "Mostrar" também cifra antes
await sql("INSERT INTO vlan_ssids (id, site, ssid, password, order_index) VALUES ('s3', 'administrativo', 'NOVA', 'outra-senha', 0)")
expect('seed novo: "Mostrar" funciona', (await call('admin', 'GET', '/api/vlans/ssids/s3/reveal')).j?.password, 'outra-senha')
expect('...e já ficou cifrado', (await sql("SELECT password FROM vlan_ssids WHERE id = 's3'"))[0].password, null)

// ── Limite de tentativas (30 por minuto por pessoa) ───────────────────────
// Já foram 3 revelações acima; completa 30 e a 31ª é barrada.
const statuses = []
for (let i = 0; i < 27; i++) statuses.push((await call('admin', 'GET', '/api/vlans/ssids/s1/reveal')).s)
expect('até 30 senhas por minuto passam', statuses.every(s => s === 200), true)
r = await call('admin', 'GET', '/api/vlans/ssids/s1/reveal')
expect('a 31ª é barrada (429)', r.s, 429)
expect('...com mensagem clara', r.j?.error, 'Muitas senhas em pouco tempo — espere um minuto.')
expect('...o Cofre usa o mesmo limite', (await call('admin', 'GET', '/api/vault/x/reveal')).s, 429)
expect('...e o ticket de download também', (await call('admin', 'POST', '/api/auth/download-ticket', { path: '/api/kb/x/attachment' })).s, 429)
expect('outra pessoa não é afetada', (await call('colab', 'POST', '/api/auth/download-ticket', { path: '/api/kb/x/attachment' })).s, 200)

// Login: 60 por minuto por IP
const logins = []
for (let i = 0; i < 61; i++) logins.push((await call(null, 'POST', '/api/auth/google', { credential: 'invalido' })).s)
expect('login: 60 tentativas passam pro Google (recusadas por credencial)', logins.slice(0, 60).every(s => s !== 429), true)
expect('login: a 61ª é barrada (429)', logins[60], 429)

// ── Aviso do cache do Total perto do limite ───────────────────────────────
// Sem GLPI no teste: chama a função de aviso direto, com um banco de mentira
// que guarda o app_settings e as notificações criadas.
const { alertRawSize, RAW_ALERT_CHARS } = await import('../src/lib/glpiTotalSync.js')
const settings = new Map(), notified = []
const fakeDb = {
  prepare: q => ({
    async get(...a) { return q.includes('FROM app_settings') ? (settings.has('glpi_total_raw_alert_at') ? { value: settings.get('glpi_total_raw_alert_at') } : null) : null },
    async all() { return q.includes('FROM users') ? [{ id: 'adm1' }, { id: 'adm2' }] : [] },
    async run(...a) { if (q.includes('INTO app_settings')) settings.set('glpi_total_raw_alert_at', a[0]); if (q.includes('INTO notifications')) notified.push(a); return {} },
  }),
}
await alertRawSize(fakeDb, 'SERVICE DESK', 900_000)
expect('cache de 0,9 MB: sem aviso', notified.length, 0)
await alertRawSize(fakeDb, 'SERVICE DESK', RAW_ALERT_CHARS + 1)
expect('acima de 1,5 MB: avisa os 2 Super Admins', notified.length, 2)
expect('...o aviso leva pra tela do Total', notified[0]?.[5], '/chamados-total')
await alertRawSize(fakeDb, 'SERVICE DESK', RAW_ALERT_CHARS + 1)
expect('...no máximo 1 aviso por dia', notified.length, 2)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
