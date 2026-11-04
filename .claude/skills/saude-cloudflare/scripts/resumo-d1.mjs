// Uso do banco D1 nas últimas 24 h e as consultas que mais leem e gravam,
// comparado com os limites do plano grátis. Precisa do wrangler logado na conta certa.
//   node .claude/skills/saude-cloudflare/scripts/resumo-d1.mjs
import { execSync } from 'node:child_process'

const run = cmd => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20 * 1024 * 1024 })
const LIMITS = { rows_read_24h: 5_000_000, rows_written_24h: 100_000 }

const info = run('npx wrangler d1 info uniflow --json')
const data = JSON.parse(info.slice(info.indexOf('{')))
const fmt = n => Number(n).toLocaleString('pt-BR')
console.log(`Tamanho do banco: ${((data.database_size ?? data.file_size) / 1024 / 1024).toFixed(1)} MB`)
for (const [k, label] of [['rows_read_24h', 'Linhas lidas (24 h)'], ['rows_written_24h', 'Linhas gravadas (24 h)']]) {
  const v = data[k] ?? 0
  console.log(`${label}: ${fmt(v)} de ${fmt(LIMITS[k])}/dia (${Math.round(v / LIMITS[k] * 100)}%)`)
}
console.log('(as gravações incluem cargas de backup feitas no período, se houve)')

for (const [sort, field, label] of [['reads', 'totalRowsRead', 'LEEM'], ['writes', 'totalRowsWritten', 'GRAVAM']]) {
  const out = run(`npx wrangler d1 insights uniflow --sort-by ${sort} --limit 8 --json`)
  const rows = JSON.parse(out.slice(out.indexOf('[')))
  console.log(`\n— consultas que mais ${label} (24 h)`)
  for (const q of rows) console.log(String(fmt(q[field])).padStart(10), 'linhas,', String(q.numberOfTimesRun).padStart(6), 'vezes |', q.query.replace(/\s+/g, ' ').slice(0, 90))
}
