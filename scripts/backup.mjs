// Backup do banco de produção (D1): `npm run backup`.
// Exporta tudo em SQL, compacta (.sql.gz) e guarda FORA do repositório — tem
// dados sensíveis (Cofre cifrado, senhas de Wi-Fi, e-mails, logs). Pasta padrão:
// Documentos\UniFlow-backups (mude com a variável UNIFLOW_BACKUP_DIR). Mantém os
// 12 mais recentes. O release.mjs também chama isto antes de aplicar migração.
// Atenção: durante o export (alguns segundos) o D1 fica indisponível para consultas.
// Restaurar: `npx wrangler d1 execute uniflow --remote --file <arquivo.sql>`
// (descompacte antes; num banco NOVO/vazio, nunca por cima do de produção sem pensar).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { run, step, fail, DB_NAME, ACCOUNT_ID } from './lib.mjs'

const KEEP = 12
const DIR = process.env.UNIFLOW_BACKUP_DIR || path.join(os.homedir(), 'Documents', 'UniFlow-backups')

export function backup() {
  step('Conferindo a conta do Cloudflare')
  const who = run('npx wrangler whoami', { capture: true })
  if (!who.out.includes(ACCOUNT_ID)) fail('wrangler não está na conta certa (luiz.sanchez@colegioser.com). Rode: npx wrangler logout && npx wrangler login')

  fs.mkdirSync(DIR, { recursive: true })
  const d = new Date(), p = n => String(n).padStart(2, '0') // horário local, como no relógio
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  const sql = path.join(DIR, `uniflow-${stamp}.sql`)
  step(`Exportando o banco para ${sql}.gz`)
  const r = run(`npx wrangler d1 export ${DB_NAME} --remote --output "${sql}"`, { capture: true })
  if (!r.ok || !fs.existsSync(sql)) fail(`export falhou:\n${r.out.slice(-800)}`)

  fs.writeFileSync(`${sql}.gz`, zlib.gzipSync(fs.readFileSync(sql)))
  fs.unlinkSync(sql)
  const mb = (fs.statSync(`${sql}.gz`).size / 1024 / 1024).toFixed(1)

  // Apaga só backups gerados por este script, deixando os KEEP mais novos.
  const old = fs.readdirSync(DIR).filter(f => /^uniflow-[\d-]+\.sql\.gz$/.test(f)).sort().reverse().slice(KEEP)
  old.forEach(f => fs.unlinkSync(path.join(DIR, f)))
  console.log(`✔ Backup pronto (${mb} MB)${old.length ? ` — ${old.length} antigo(s) removido(s)` : ''}`)
  return `${sql}.gz`
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) backup()
