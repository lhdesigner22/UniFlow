// Utilidades dos scripts de operação (release.mjs, backup.mjs).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DB_NAME = 'uniflow'
// Conta certa do Cloudflare (luiz.sanchez@colegioser.com). O wrangler já trocou
// sozinho de conta 2x — publicar na errada dá erro 7403 ou, pior, sobe noutro lugar.
export const ACCOUNT_ID = '8c6d91019b900e6ed5c4274cd5c18aa8'
export const PROD_URL = 'https://uniflow.serfecaf.workers.dev'

// Roda um comando na raiz. `capture` devolve a saída; senão ela aparece na tela.
export function run(cmd, { capture = false } = {}) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` }
}

export function step(msg) { console.log(`\n▶ ${msg}`) }
export function fail(msg) { console.error(`\n✖ ${msg}`); process.exit(1) }
