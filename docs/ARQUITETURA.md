# Arquitetura

## Visão geral

```
Navegador
   │
   ▼
Cloudflare Worker (server/src/worker.js)
   ├── serve os arquivos estáticos do React (client/dist) — via "assets" do wrangler.jsonc
   ├── /api/*  → roteado pro Hono (fetch handler)
   └── scheduled() → 4 cron triggers (sync com o GLPI, SLA, e-mails)
         │
         ▼
   Cloudflare D1 (SQLite gerenciado) — server/src/db.js
```

Tudo — front-end, API e crons — é **um único Worker, um único deploy**. Não
existe um servidor Express separado nem um front-end hospedado à parte (isso
mudou numa migração anterior; veja `docs/LICOES_APRENDIDAS.md` se quiser o
histórico). O roteamento entre "serve o React" e "roda a API" é feito pelo
próprio Cloudflare, configurado em `wrangler.jsonc`:

```jsonc
"assets": {
  "directory": "./client/dist",
  "not_found_handling": "single-page-application", // qualquer rota sem arquivo cai no index.html (client-side routing do React Router)
  "run_worker_first": ["/api/*"] // só /api/* passa pelo Hono; o resto é arquivo estático
}
```

## Backend (`server/src/`)

- **`worker.js`** — monta todas as rotas (`app.route('/api/x', xRoutes)`) e
  exporta o `scheduled()` (os 4 cron jobs — ver `docs/DEPLOY.md`).
- **`db.js`** — fábrica `createDb(env)` que embrulha o binding nativo `env.DB`
  do D1 num shape mais simples (`db.prepare(sql).get/all/run(...)`,
  `db.scalar(...)`, `db.batch([...])`). Toda rota recebe essa instância via
  `c.get('db')` (middleware global em `worker.js`), nunca importa D1
  diretamente — é assim que dá pra trocar de banco no futuro sem tocar em
  cada rota.
- **`middleware/auth.js`** — lê o JWT do header `Authorization: Bearer ...`
  (ou um ticket de download em `?ticket=` — 60s, só GET, preso ao caminho do
  anexo, pedido em `POST /api/auth/download-ticket`; ver `lib/requestToken.js` —
  porque um `<a href>` não manda header customizado) e injeta `c.set('user', payload)`.
  O payload do JWT é só `{ id, name, email }` — **nunca** o `system_role`,
  de propósito: o papel do usuário é sempre resolvido com uma consulta fresca
  no banco a cada rota, então mudar o papel de alguém no Admin tem efeito
  imediato, sem precisar a pessoa deslogar/logar de novo.
- **`routes/*.js`** — um arquivo por domínio (boards, cards, kb, glpi...).
  Cada um monta seu próprio `app.use('*', auth)` (repetido em cada arquivo,
  não centralizado — é assim historicamente, funciona, só é um pouco
  repetitivo se for mexer em auth de novo).
- **`lib/*.js`** — lógica que não é rota HTTP: acesso a quadro
  (`boardAccess.js`), sincronização com GLPI (`glpi*.js`), e-mail
  (`email.js`), JWT/senha/Google OAuth, agendamentos (`schedule.js`), Drive
  (`driveClient.js`).

## Frontend (`client/src/`)

React 18 + Vite, sem framework de estado pesado — `zustand` só pra 3 stores
globais (`store/authStore.js`, `notificationStore.js`, `dialogStore.js`).
Cada página é `pages/XPage.jsx` + `pages/XPage.module.css` (CSS Modules).
Componentes reutilizados ficam em `components/common/` (`Modal`, diálogos de
confirmação, `MemberPicker`...) e `components/layout/` (`Sidebar`, `Topbar`,
`AppLayout`).

Duas coisas não óbvias sobre o CSS:

1. **`@keyframes` NÃO são isoladas por CSS Modules neste build** — uma
   animação declarada em `index.css` (global) pode ser referenciada por nome
   (`animation: fadeIn ...`) de qualquer `*.module.css`, sem reimportar nada.
   Isso é usado de propósito em vários lugares (ver `client/src/index.css`).
   Só CUIDADO pra não declarar `@keyframes` com o MESMO NOME em dois lugares
   diferentes achando que estão isolados — eles não estão, e o último a ser
   processado no bundle "ganha" globalmente.
2. Cards que usam `@dnd-kit` (`CardItem.jsx`, `LinkCard` em
   `InternetLinksPage.jsx`) recebem um `style={{ transform: ... }}` **inline**
   do próprio dnd-kit. Um `:hover { transform: ... }` no CSS module funciona
   normalmente enquanto o item NÃO está sendo arrastado (nesse caso o dnd-kit
   deixa `transform` como `undefined`, e o CSS assume) — mas durante o drag o
   inline sempre ganha. É assim que dá pra ter hover-lift E drag ao mesmo
   tempo sem conflito.

## Autenticação e papéis de acesso

Três papéis, coluna `users.system_role` (texto livre, sem CHECK constraint):

| Papel | Valor no banco | O que pode ver | O que pode alterar |
|---|---|---|---|
| Usuário | `user` (padrão) | Só os próprios quadros/cadastros | O que já tinha antes: cria/edita o que é seu |
| Auditor | `auditor` | **Tudo**, de todo mundo (todos os quadros, painéis administrativos em modo leitura) | **Nada**, exceto a Base de Conhecimento (qualquer artigo, não só o próprio) |
| Super Admin | `super_admin` | Tudo | Tudo |

O bloqueio de escrita do Auditor é feito **num único lugar**, um middleware
global em `worker.js` (não rota por rota): qualquer requisição não-GET desse
papel é rejeitada com 403 antes de chegar em qualquer handler, com exceção de
`/api/kb`, `/api/auth` (perfil próprio) e `/api/notifications` (marcar as
próprias notificações como lidas). Se um dia perceber que uma rota nova
"esqueceu" de checar o Auditor, ela já está protegida por padrão — só a
VISIBILIDADE (o que aparece em GETs) precisa ser liberada rota a rota (ver
`lib/boardAccess.js` e os middlewares `superAdmin` em `admin.js`,
`slaRules.js`, `appSettings.js`, `glpi.js`, que aceitam Auditor só em GET).

**Promoção automática a Super Admin** (`routes/auth.js`, função
`autoPromote`): o primeiro usuário que se cadastra no sistema vira
`super_admin` automaticamente; depois disso, qualquer e-mail na lista
`OWNER_EMAILS` (hardcoded no código, hoje só `luiz.sanchez@colegioser.com`) ou
no secret `SUPER_ADMIN_EMAILS` (lista separada por vírgula, **não está
configurado em produção hoje** — só o hardcoded vale) é promovido no login.

## Visibilidade de quadros (Kanban)

Não é simplesmente "dono vê, resto não vê". A regra real
(`lib/boardAccess.js`):

- Dono do quadro → enxerga.
- Membro convidado → enxerga.
- Super Admin **com departamento definido** → enxerga também os quadros cujo
  DONO seja do mesmo departamento (visão "de área", sem precisar ser
  convidado quadro a quadro) — papel retornado como `'dept_admin'`.
- Auditor → enxerga **todos os quadros, sem exceção**, papel retornado como
  `'viewer'`.

`'viewer'` e `'dept_admin'` nunca devem ser tratados como suficiente pra
ações de escrita numa checagem tipo `if (role !== 'owner' && role !== 'admin')`
— mas mesmo que uma rota erre nisso, o middleware global do Auditor (acima)
já barra a escrita antes de chegar lá. `dept_admin` é mais permissivo por
design: cobre ver o quadro, mexer em cards e arquivar/desarquivar, mas
renomear/excluir o quadro continua exigindo `owner`/`admin` de verdade.
