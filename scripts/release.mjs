// Publicação em produção num comando só: `npm run release`.
// Faz, em ordem, parando no primeiro erro (era tudo à mão — ver docs/DEPLOY.md):
//   1. confere a conta do Cloudflare (o wrangler já trocou sozinho 2x);
//   2. recusa se houver alteração não commitada (`--allow-dirty` para forçar);
//   3. se houver migração pendente: backup do banco e depois aplica;
//   4. build do client; 5. wrangler deploy;
//   6. confere se o site está servindo a versão que acabou de ser gerada.
import fs from 'node:fs'
import path from 'node:path'
import { run, step, fail, ROOT, DB_NAME, ACCOUNT_ID, PROD_URL } from './lib.mjs'
import { backup } from './backup.mjs'

step('Conferindo a conta do Cloudflare')
const who = run('npx wrangler whoami', { capture: true })
if (!who.out.includes(ACCOUNT_ID)) fail('wrangler não está na conta certa (luiz.sanchez@colegioser.com). Rode: npx wrangler logout && npx wrangler login')
console.log('✔ conta certa')

step('Conferindo alterações não commitadas')
const dirty = run('git status --porcelain --untracked-files=no', { capture: true }).out.trim()
if (dirty && !process.argv.includes('--allow-dirty')) fail(`há alterações não commitadas — commite antes (ou use --allow-dirty):\n${dirty}`)
console.log(dirty ? '⚠ publicando com alterações não commitadas (--allow-dirty)' : '✔ tudo commitado')

step('Conferindo migrações pendentes')
const list = run(`npx wrangler d1 migrations list ${DB_NAME} --remote`, { capture: true })
if (!list.ok) fail(`não consegui listar as migrações (erro 7403 = conta errada; às vezes é passageiro, tente de novo):\n${list.out.slice(-800)}`)
if (/No migrations to apply/i.test(list.out)) {
  console.log('✔ nenhuma migração pendente')
} else {
  console.log(list.out.split('\n').filter(l => /\d{4}_/.test(l)).join('\n'))
  backup()
  step('Aplicando migrações')
  if (!run(`npx wrangler d1 migrations apply ${DB_NAME} --remote`).ok) fail('migração falhou — nada foi publicado. O backup está na pasta de backups.')
}

step('Build')
if (!run('npm run build').ok) fail('build falhou — nada foi publicado')

step('Deploy')
if (!run('npx wrangler deploy').ok) fail('deploy falhou')

step('Conferindo produção')
const local = fs.readFileSync(path.join(ROOT, 'client', 'dist', 'index.html'), 'utf8').match(/assets\/index-[\w-]+\.js/)?.[0]
const prod = (await (await fetch(`${PROD_URL}/?v=${Date.now()}`)).text()).match(/assets\/index-[\w-]+\.js/)?.[0]
if (!local || local !== prod) fail(`produção ainda não serve a versão nova (local ${local}, produção ${prod}) — confira em alguns segundos`)
console.log(`✔ no ar: ${PROD_URL} (${prod})`)
console.log('\nLembrete: avise para fechar e reabrir a aba (o app guarda a versão antiga).')
