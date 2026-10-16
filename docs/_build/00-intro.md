# UniFlow — Documentação Técnica

Sistema interno do TI do Colégio SER / UniFECAF: quadros Kanban com controle
de tempo, chamados sincronizados do GLPI, base de conhecimento, aprovações,
organograma e reconhecimento da equipe, cadastros (empresas, links de
internet, impressoras), agenda de eventos e métricas — tudo em um só lugar,
com login único e papéis de acesso (Usuário / Auditor / Super Admin).

Em produção em: **https://uniflow.serfecaf.workers.dev**

Este documento existe pra que qualquer pessoa que assuma o projeto depois
consiga entender como ele funciona, sem precisar reconstruir esse
conhecimento na base de tentativa e erro. Ele acompanha o repositório de
código (onde também existe em Markdown, arquivo por seção, em `docs/`) — aqui
está tudo reunido num único documento.

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
único deploy (`npx wrangler deploy`), um único domínio, um único
`wrangler.jsonc`.

## Rodando localmente

```bash
npm run install:all   # instala server/ e client/
cd client && npm run dev   # http://localhost:5173, com proxy pra /api
```

Pra testar o Worker de verdade localmente (com D1 local):

```bash
npx wrangler dev
```

## Deploy rápido

```bash
cd client && npm run build   # gera client/dist
cd .. && npx wrangler deploy
```

Checklist completo de deploy, secrets e cron jobs: seção **Deploy e
Operação**, mais adiante neste documento.

## Pastas que você pode ignorar

Na raiz do repositório sobraram alguns arquivos de quando o projeto rodava em
Render + Vercel + Turso (antes da migração pra Cloudflare): `railway.toml`,
`render.yaml`, `start.bat`, `uniflow.db`, `uploads/`, e um `index.html` solto
na raiz (~45 KB, não confundir com `client/index.html`, que é o de verdade).
Nada disso é usado hoje — nenhum deploy, script ou import aponta pra eles.
Seguros de apagar num dia de faxina.

## Como este documento está organizado

1. **Arquitetura** — como as peças se encaixam, autenticação, papéis de acesso.
2. **Banco de Dados** — todas as tabelas, o que cada uma guarda, como migrar.
3. **Funcionalidades** — cada módulo/tela do sistema, o que faz e onde mexer.
4. **Integrações** — GLPI, Google (login/Drive/Gmail), e-mail.
5. **Deploy e Operação** — checklist de deploy, cron jobs, limites do plano Free.
6. **Lições Aprendidas** — bugs reais já resolvidos e porquês de decisões não
   óbvias — leia antes de "consertar" algo que parece estranho.
