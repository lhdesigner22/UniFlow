// Plano B quando o `wrangler dev --local` não sobe (o runtime workerd quebrou
// com "access violation" no Windows 11 Insider 26300, out/2026): roda o MESMO
// server/src/worker.js direto no Node, com um D1 de mentira em SQLite
// (node:sqlite, já vem no Node 22+) e as migrações reais. Sobe na mesma porta
// 8799, então os testes de test-e2e/*.mjs rodam sem mudar nada.
// Não tem: tempo real (Durable Object), Browser Rendering, arquivos estáticos.
//
//   cd server && node test-e2e/node-server.mjs     (banco novo em memória a cada execução)
//   MOCK_GMAIL=1 node test-e2e/node-server.mjs      (+ Gmail de mentira, pra loan-replies-e2e.mjs)
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `cloudflare:workers` só existe no runtime da Cloudflare → módulo vazio.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'stub:cloudflare-workers', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'stub:cloudflare-workers') return { format: 'module', source: 'export class DurableObject {}', shortCircuit: true }
    return next(url, context)
  },
})

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const sqlite = new DatabaseSync(':memory:')

// Mesmo comportamento do D1 nos pontos que importam: undefined é erro,
// boolean vira 0/1.
const toParam = v => {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined não é um tipo suportado')
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}
function d1Statement(sql, params = []) {
  const stmt = () => sqlite.prepare(sql)
  const p = () => params.map(toParam)
  return {
    bind: (...args) => d1Statement(sql, args),
    async first() { return stmt().get(...p()) ?? null },
    async all() { return { results: stmt().all(...p()), success: true } },
    async run() { const r = stmt().run(...p()); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
    async raw() { return stmt().all(...p()).map(r => Object.values(r)) },
    _exec() { return stmt().run(...p()) },
  }
}
const DB = {
  prepare: sql => d1Statement(sql),
  async batch(list) {
    sqlite.exec('BEGIN')
    try { const out = list.map(s => s._exec()); sqlite.exec('COMMIT'); return out } catch (e) { sqlite.exec('ROLLBACK'); throw e }
  },
}

const migDir = path.join(root, 'migrations')
for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join(migDir, f), 'utf8'))
}
for (const f of (process.env.SEEDS || 'seed-base.sql,dept-seed.sql').split(',').filter(Boolean)) {
  sqlite.exec(fs.readFileSync(path.join(here, f), 'utf8'))
}

const { default: worker } = await import('../src/worker.js')
const env = {
  DB,
  JWT_SECRET: 'testsecret',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GLPI_BASE_URL: 'http://127.0.0.1:8798', GLPI_APP_TOKEN: 't', GLPI_USER_TOKEN: 't',
  VAULT_ENCRYPTION_KEY: 'dGVzdGUtZG8tY29mcmUtdW5pZmxvdy0zMi1ieXRlcyE=', // chave de TESTE (32 bytes), só local
}
const ctx = { waitUntil() {}, passThroughOnException() {} }

// ── MOCK_GMAIL=1: Gmail de mentira (envio + caixa de entrada) ────────────
// Intercepta o fetch pros hosts do Google. Controle pelos endpoints /__mock/*
// (só existem neste servidor de teste):
//   POST /__mock/gmail/inbox  {id, threadId, from, subject, text?, html?}  → põe na caixa
//   GET  /__mock/gmail/sent                                               → enviados
//   POST /__mock/gmail/mode   {oauthCanRead}                              → token OAuth só de envio?
//   POST /__mock/cron         {cron, minute}                              → roda o scheduled()
//   GET  /__mock/setting?key=  ·  POST /__mock/setting {key, value}       → lê / grava app_settings
const mock = { sent: [], inbox: [], oauthCanRead: true }
if (process.env.MOCK_GMAIL) {
  const { generateKeyPairSync } = await import('node:crypto')
  Object.assign(env, {
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh', GMAIL_SENDER_EMAIL: 'helpdesk.ti@fecaf.com.br',
    GOOGLE_SA_EMAIL: 'sa@test.iam.gserviceaccount.com',
    GOOGLE_SA_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
  })
  const b64url = s => Buffer.from(s, 'utf8').toString('base64url')
  const realFetch = globalThis.fetch
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.host === 'oauth2.googleapis.com') {
      const body = new URLSearchParams(String(init.body || ''))
      return json({ access_token: body.get('grant_type') === 'refresh_token' ? 'oauth-token' : 'sa-token' })
    }
    if (url.host !== 'gmail.googleapis.com') return realFetch(input, init)
    const token = String(init.headers?.Authorization || '').replace('Bearer ', '')
    if (url.pathname.endsWith('/messages/send')) {
      const raw = Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8')
      const n = mock.sent.length + 1
      mock.sent.push({ raw, threadId: `t-${n}` })
      return json({ id: `sent-${n}`, threadId: `t-${n}` })
    }
    if (token === 'oauth-token' && !mock.oauthCanRead) return json({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403)
    if (url.pathname.endsWith('/messages')) return json({ messages: mock.inbox.map(m => ({ id: m.id, threadId: m.threadId })) })
    const m = mock.inbox.find(x => url.pathname.endsWith(`/messages/${x.id}`))
    if (!m) return json({ error: 'not found' }, 404)
    const parts = []
    if (m.text) parts.push({ mimeType: 'text/plain', body: { data: b64url(m.text) } })
    if (m.html) parts.push({ mimeType: 'text/html', body: { data: b64url(m.html) } })
    return json({
      id: m.id, threadId: m.threadId, internalDate: String(m.internalDate || Date.now()), snippet: (m.text || '').slice(0, 100),
      payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }], parts },
    })
  }
}
// ── Login Google de mentira (sempre ligado neste servidor) ────────────────
// POST /__mock/google-token {email, name} → ID token assinado por uma chave
// local, cujo JWKS é servido no lugar de googleapis.com/oauth2/v3/certs.
// Dá pra testar o POST /api/auth/google (1º acesso, cargo padrão) sem Google.
const { SignJWT, exportJWK, generateKeyPair } = await import('jose')
const googleKeys = await generateKeyPair('RS256')
const googleJwk = { ...(await exportJWK(googleKeys.publicKey)), kid: 'mock-google', alg: 'RS256', use: 'sig' }
env.GOOGLE_CLIENT_ID ||= 'mock-google-client'
{
  const prevFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url
    if (href.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
      return new Response(JSON.stringify({ keys: [googleJwk] }), { headers: { 'Content-Type': 'application/json' } })
    }
    return prevFetch(input, init)
  }
}
const mockGoogleToken = ({ email, name }) => new SignJWT({ email, name: name || email, email_verified: true, sub: `g-${email}` })
  .setProtectedHeader({ alg: 'RS256', kid: 'mock-google' }).setIssuer('https://accounts.google.com')
  .setAudience(env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('10m').sign(googleKeys.privateKey)

async function mockControl(req, url, body) {
  if (url.pathname === '/__mock/google-token') return { credential: await mockGoogleToken(JSON.parse(body)) }
  if (url.pathname === '/__mock/gmail/inbox') { mock.inbox.push(JSON.parse(body)); return { ok: true } }
  if (url.pathname === '/__mock/gmail/sent') return mock.sent
  if (url.pathname === '/__mock/gmail/mode') { Object.assign(mock, JSON.parse(body)); return { ok: true } }
  if (url.pathname === '/__mock/cron') {
    const { cron, minute = 0 } = JSON.parse(body)
    const at = new Date(); at.setUTCMinutes(minute)
    await worker.scheduled({ cron, scheduledTime: at.getTime() }, env, ctx)
    return { ok: true }
  }
  if (url.pathname === '/__mock/setting' && req.method === 'POST') {
    const { key, value } = JSON.parse(body)
    sqlite.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    return { ok: true }
  }
  if (url.pathname === '/__mock/setting') return sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(url.searchParams.get('key')) || null
  return null
}

const PORT = Number(process.env.PORT || 8799)
createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  // Igual ao `wrangler dev --test-scheduled`: GET /cdn-cgi/handler/scheduled?cron=...
  if (req.url.startsWith('/cdn-cgi/handler/scheduled')) {
    const cron = new URL(req.url, 'http://x').searchParams.get('cron') || '* * * * *'
    await worker.scheduled({ cron, scheduledTime: Date.now() }, env, ctx)
    res.writeHead(200); res.end('ok'); return
  }
  if (req.url.startsWith('/__mock/')) {
    const out = await mockControl(req, new URL(req.url, 'http://x'), body?.toString() || '{}')
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return
  }
  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  })
  try {
    const r = await worker.fetch(request, env, ctx)
    res.writeHead(r.status, Object.fromEntries(r.headers))
    res.end(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    console.error(e)
    res.writeHead(500); res.end(String(e?.message || e))
  }
}).listen(PORT, '127.0.0.1', () => console.log(`node-server pronto em http://127.0.0.1:${PORT}`))
