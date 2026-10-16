// Plano B quando o `wrangler dev --local` não sobe (o runtime workerd quebrou
// com "access violation" no Windows 11 Insider 26300, out/2026): roda o MESMO
// server/src/worker.js direto no Node, com um D1 de mentira em SQLite
// (node:sqlite, já vem no Node 22+) e as migrações reais. Sobe na mesma porta
// 8799, então os testes de test-e2e/*.mjs rodam sem mudar nada.
// Não tem: tempo real (Durable Object), Browser Rendering, arquivos estáticos.
//
//   cd server && node test-e2e/node-server.mjs     (banco novo em memória a cada execução)
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
}
const ctx = { waitUntil() {}, passThroughOnException() {} }

const PORT = Number(process.env.PORT || 8799)
createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
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
