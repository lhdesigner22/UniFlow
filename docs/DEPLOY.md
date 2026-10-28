# Deploy e operação

## Deploy normal (já existe o projeto, só publicar uma mudança)

**Use `npm run release`** (na raiz, `scripts/release.mjs`): confere a conta do
Cloudflare, recusa alteração não commitada, faz backup e aplica migração se
houver, build, deploy e confere se produção já serve a versão nova — parando no
primeiro erro.

## Backup do banco

`npm run backup` (`scripts/backup.mjs`): exporta o D1 de produção em SQL
compactado para `Documentos\UniFlow-backups` (fora do repositório — tem dados
sensíveis; outra pasta: variável `UNIFLOW_BACKUP_DIR`) e mantém os 12 mais
novos. O `release` faz um sozinho antes de aplicar migração. Os crons do
Cloudflare estão todos ocupados, então o backup periódico roda nesta máquina.
Restaurar: descompactar e `npx wrangler d1 execute <banco> --remote --file arquivo.sql`
(de preferência num banco novo, conferir, e só então trocar).

## Passo a passo manual (o que o `release` faz)

```bash
cd client && npm run build    # gera client/dist
cd .. && npx wrangler deploy
```

O `wrangler deploy` sobe o Worker (`server/src/worker.js`) e os arquivos
estáticos (`client/dist`) juntos, num único comando. Não precisa de mais
nada — sem passo de "subir front-end" separado.

Migração de banco pendente (mudou algo em `migrations/`):

```bash
npx wrangler d1 migrations apply uniflow --remote
```

Roda antes ou depois do `wrangler deploy`, tanto faz — é só cuidado se o
código novo já espera uma coluna/tabela nova, aplicar a migração antes de
fazer a rota nova ficar acessível. Se der erro transitório de auth
(`[code: 7403]`), rodar o mesmo comando de novo geralmente resolve sem
precisar investigar mais (aconteceu várias vezes nesta sessão).

## Checklist de secrets (produção)

Configurados hoje (`npx wrangler secret list` pra conferir os nomes — não
mostra valores):

```
ALLOWED_DOMAIN, GLPI_APP_TOKEN, GLPI_USER_TOKEN,
GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL,
GOOGLE_CLIENT_ID, GOOGLE_IMPERSONATE_EMAIL, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY,
JWT_SECRET, RESEND_API_KEY
```

Definir/trocar um secret: `npx wrangler secret put NOME_DO_SECRET` (pede o
valor interativamente, nunca fica em arquivo).

`SUPER_ADMIN_EMAILS` é **suportado no código** (`routes/auth.js`) mas **não
está configurado** — só o e-mail hardcoded em `OWNER_EMAILS` vale hoje. Ver
`docs/ARQUITETURA.md`.

Vars não-sensíveis (já em `wrangler.jsonc`, não precisam de `secret put`):
`GLPI_BASE_URL`, `GOOGLE_DRIVE_FOLDER_ID`.

## Cron jobs (4 triggers, limite da conta é 5)

Configurados em `wrangler.jsonc` → `triggers.crons`, implementados em
`server/src/worker.js` → `scheduled()`. **Não junte esses jobs num só sem
entender o motivo abaixo primeiro:**

| Cron | O que roda | Por quê é isolado |
|---|---|---|
| `* * * * *` (1 min) | Backlog de chamados (GLPI) | Só a parte leve — sem resolver técnico |
| `*/15 * * * *` | SLA + resumos de e-mail + Eventos (GLPI) + envio da fila | Passos independentes, cada um com seu próprio `catch` |
| `5,20,35,50 * * * *` | Cache de técnico (GLPI) — pesado | Isolado do Total, senão estoura o limite de subrequests |
| `10,25,40,55 * * * *` | Total de Chamados (GLPI) — pesado | 5 min depois do cache de técnico, pra já ler ele fresco |

**O motivo real de tudo isso estar separado**: o Worker no plano Free tem um
teto de **50 subrequests por invocação** (não por dia — por execução). Cada
`initSession`/`killSession` do GLPI conta como 1, cada página de busca conta
como 1. Empilhar "Eventos + cache de técnico + Total" no mesmo tick já
estourou esse limite em produção de verdade (erro visto nos logs: `Too many
subrequests by single Worker invocation`) — e como cada passo não tinha
`try/catch` próprio na época, uma falha ali derrubava até o envio dos e-mails
de resumo diário/semanal, que rodam no mesmo tick de 15 min. As duas coisas
já foram corrigidas: separação em ticks diferentes + `catch` isolado por
passo. Se for adicionar uma sincronização nova e pesada, dá ela o próprio
tick, não empilha nos existentes.

Ver logs de cron/erro: dashboard da Cloudflare → Workers & Pages → `uniflow`
→ Logs (`observability.head_sampling_rate: 1` no `wrangler.jsonc` guarda
100% das invocações, tráfego baixo o suficiente pra não pesar) — ou
`npx wrangler tail` pra ver em tempo real.

## Limites do plano Free que já mordêram este projeto

- **50 subrequests por invocação** — ver cron jobs acima.
- **CPU time por invocação** — resolver técnico de chamado (baixar toda a
  coleção `Ticket_User`/`User`) rodando a cada 1 min foi o que disparou
  consumo de CPU alto; por isso o Backlog (1 min) usa só o cache já pronto em
  D1, e a resolução de verdade roda separada, a cada 15 min.
- Nenhum limite de banda/storage do D1 mordeu até agora (uso é pequeno).
