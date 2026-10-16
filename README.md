# UniFlow

Sistema interno do TI do Colégio SER / UniFECAF: quadros Kanban com controle de
tempo, chamados sincronizados do GLPI, base de conhecimento, aprovações,
organograma e reconhecimento da equipe, cadastros (empresas, links de
internet, impressoras), agenda de eventos e métricas — tudo em um só lugar,
com login único e papéis de acesso (Usuário / Auditor / Super Admin).

Em produção em: **https://uniflow.serfecaf.workers.dev**

Este README é o ponto de partida. A documentação completa (arquitetura,
banco de dados, integrações, deploy e os perrengues já resolvidos) está em
[`docs/`](docs/) — comece por [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) se
você está chegando agora no projeto.

## Stack

- **Backend**: [Hono](https://hono.dev) rodando num único **Cloudflare
  Worker** (`server/src/worker.js`) — sem servidor Node tradicional, sem
  container.
- **Banco de dados**: **Cloudflare D1** (SQLite gerenciado), acessado via um
  wrapper fino em `server/src/db.js`.
- **Frontend**: **React 18 + Vite**, servido como assets estáticos pelo
  próprio Worker (`client/dist`, via `wrangler.jsonc` → `assets.directory`).
  PWA instalável (manifest + service worker via `vite-plugin-pwa`).
- **Auth**: JWT próprio (`jose`) + login por e-mail/senha ou Google OAuth.
- **Integrações**: GLPI (chamados, via API REST), Google Drive (anexos da
  Base de Conhecimento), e-mail (Gmail API / Cloudflare Email / Resend, o que
  estiver configurado).

Não há back-end Node separado nem front-end hospedado à parte — é tudo um
único deploy (`npx wrangler deploy`), um único domínio, um único `wrangler.jsonc`.

## Rodando localmente

```bash
npm run install:all   # instala server/ e client/
cd client && npm run dev   # http://localhost:5173, com proxy pra /api
```

Pra testar o Worker de verdade localmente (com D1 local):

```bash
npx wrangler dev
```

## Deploy

```bash
cd client && npm run build   # gera client/dist
cd .. && npx wrangler deploy
```

Migração de banco pendente? Veja [`docs/BANCO_DE_DADOS.md`](docs/BANCO_DE_DADOS.md).

## Pastas que você pode ignorar

Na raiz do repo sobraram alguns arquivos de quando o projeto rodava em
Render + Vercel + Turso (antes da migração pra Cloudflare): `railway.toml`,
`render.yaml`, `start.bat`, `uniflow.db`, `uploads/`, e um `index.html` solto
na raiz (~45 KB, não confundir com `client/index.html`, que é o de verdade).
Nada disso é usado hoje — nenhum deploy, script ou import aponta pra eles.
Seguros de apagar num dia de faxina, mas deixei como estavam por não ser o
que foi pedido nesta sessão.

## Índice da documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — como as peças se encaixam, autenticação, papéis de acesso, rotas
- [`docs/BANCO_DE_DADOS.md`](docs/BANCO_DE_DADOS.md) — todas as tabelas, o que cada uma guarda, como migrar
- [`docs/FUNCIONALIDADES.md`](docs/FUNCIONALIDADES.md) — cada módulo/tela do sistema, o que faz e onde mexer
- [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md) — GLPI, Google (login/Drive/Gmail), e-mail — segredos e configuração
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — checklist de deploy, cron jobs, limites do plano Free
- [`docs/LICOES_APRENDIDAS.md`](docs/LICOES_APRENDIDAS.md) — bugs reais já resolvidos e porquês de decisões não óbvias — leia antes de "consertar" algo que parece estranho
