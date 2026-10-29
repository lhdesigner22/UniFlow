// Roda todas as suítes de ponta a ponta, na ordem certa, cada grupo num
// servidor de teste recém-subido (node-server.mjs, banco novo em memória).
// É o que o GitHub Actions roda a cada push (.github/workflows/e2e.yml).
//   cd server && npm test
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://127.0.0.1:8799'

// Ordem importa: `security` e `download-ticket` derrubam a sessão de usuários de teste.
const GROUPS = [
  { env: {}, suites: ['roles', 'dept', 'developments', 'lab-incidents', 'printer-supplies', 'success-cases', 'dept-modules', 'labels', 'machine-standards', 'kudos', 'audit', 'security', 'download-ticket'] },
  { env: { RATE_LIMIT: '1' }, suites: ['secrets'] },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function startServer(extraEnv) {
  const proc = spawn(process.execPath, [path.join(here, 'node-server.mjs')], { env: { ...process.env, PORT: '8799', ...extraEnv }, stdio: process.env.SERVER_LOG ? 'inherit' : 'ignore' }) // SERVER_LOG=1 mostra o log do servidor
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/auth/health`)).ok) return proc } catch {}
    await sleep(500)
  }
  proc.kill()
  throw new Error('servidor de teste não subiu em 30s')
}
function runSuite(name) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(here, `${name}-e2e.mjs`)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => p.kill(), 180_000)
    p.on('close', code => { clearTimeout(timer); resolve({ code, out }) })
  })
}

let failed = 0
for (const group of GROUPS) {
  const server = await startServer(group.env)
  try {
    for (const name of group.suites) {
      const { code, out } = await runSuite(name)
      const oks = (out.match(/^OK /gm) || []).length
      const fails = out.split('\n').filter(l => l.startsWith('FALHA'))
      if (code === 0 && !fails.length) console.log(`✔ ${name}: ${oks} ok`)
      else { failed++; console.log(`✖ ${name}: ${oks} ok, ${fails.length} falha(s)\n${(fails.length ? fails.join('\n') : out.slice(-1500))}`) }
    }
  } finally {
    server.kill()
    await sleep(500)
  }
}
console.log(failed ? `\n${failed} suíte(s) com falha` : '\nTodas as suítes passaram')
process.exit(failed ? 1 : 0)
