# Integrações externas

## GLPI (chamados)

`server/src/lib/glpiClient.js` fala com a API REST do GLPI
(`{GLPI_BASE_URL}/apirest.php/...`). Autenticação por `initSession` (App-Token
+ user token) → `Session-Token` usado nas chamadas seguintes → `killSession`
no fim. **Só leitura** — o UniFlow nunca cria/edita/fecha chamado no GLPI.

Secrets necessários: `GLPI_APP_TOKEN`, `GLPI_USER_TOKEN`. Var não-sensível já
em `wrangler.jsonc`: `GLPI_BASE_URL`.

Três buscas diferentes, cada uma isolada no seu próprio cron (ver
`docs/DEPLOY.md` pro porquê):
1. **Backlog** — só chamados em aberto, busca leve (1 min).
2. **Total** — todo o histórico da entidade, busca pesada, ~10 mil+ chamados (15 min).
3. **Cache de técnico** — baixa TODA a coleção `Ticket_User` + `User` pra
   resolver nome de técnico (o campo de busca "técnico" do `/search/Ticket`
   não é confiável nesta instalação — já testado, vinha número solto em vez
   de nome). Cacheado à parte porque é a parte mais cara (15 min, offset).
4. **Eventos** — busca chamados de uma fila configurável (status/entidade,
   configurados no Admin) e importa como Eventos da Agenda (15 min).

Botão manual "Atualizar agora" (Backlog/Total): dispara os 3 sincronismos
manuais (backlog, total, eventos) via `client/src/utils/glpiRefresh.js` —
como **3 requisições HTTP separadas**, não uma função que faz tudo num
handler só. Isso é proposital: cada requisição HTTP vira uma invocação de
Worker separada, cada uma com seu próprio teto de 50 subrequests do plano
Free — combinar tudo numa função só reintroduziria o mesmo estouro de limite
que já foi corrigido nos crons (ver `docs/LICOES_APRENDIDAS.md`).

## Google — três usos separados, três credenciais separadas

Não confundir os três: são coisas diferentes, com secrets diferentes.

### 1. Login (OAuth "Sign in with Google")
`server/src/lib/googleAuth.js`, `routes/auth.js` (`POST /api/google`)

Verifica o ID token que o front-end recebe do Google contra
`GOOGLE_CLIENT_ID`. `ALLOWED_DOMAIN` (opcional) restringe quem pode entrar
por domínio de e-mail. Secrets: `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`.

### 2. Anexos (Google Drive)
`server/src/lib/driveClient.js` — usado pela Base de Conhecimento, Impressoras
(driver) e Aprovações (anexo).

Autentica como uma **Service Account** com **delegação em todo o domínio**
(domain-wide delegation) — não pelo bearer normal da service account. Isso
foi descoberto na prática: uma service account sozinha conta como identidade
EXTERNA ao Workspace, e o Workspace bloqueia externos de acessar Drives
Compartilhados mesmo depois de "adicionados" manualmente
(`visibleSharedDrives` voltava vazio). Com a delegação autorizada no Admin
Console do Workspace (pelo Client ID numérico da service account), o JWT usa
`sub` = uma conta real da organização (`GOOGLE_IMPERSONATE_EMAIL`), e a API
passa a agir como se fosse essa pessoa — sem fronteira de "externo".

`GOOGLE_DRIVE_FOLDER_ID` é, na prática, um **Drive Compartilhado** (ID começa
com `0A`) — por isso toda chamada usa `supportsAllDrives=true`; sem esse
parâmetro, chamadas num Drive Compartilhado falham ou ignoram o conteúdo
mesmo com a service account tendo acesso.

Secrets: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_IMPERSONATE_EMAIL`.
Var não-sensível: `GOOGLE_DRIVE_FOLDER_ID`.

### 3. Envio de e-mail (Gmail API — opcional, ver abaixo)

## E-mail — 3 provedores em cascata, só 1 precisa estar configurado

`server/src/lib/email.js`. Todo e-mail do sistema (alertas de SLA, resumos
diário/semanal, o que mais vier) primeiro é gravado em `email_outbox`
(`queueEmail`, nunca falha) e só depois `flushOutbox` tenta enviar de fato,
escolhendo o primeiro provedor disponível nesta ordem:

1. **Gmail API** (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL`) — envia como uma caixa real
   do Google Workspace já existente. Vantagem: manda pra **qualquer**
   destinatário, sem precisar verificar domínio em nenhum provedor
   transacional. **É o que está configurado em produção hoje.**
2. **Cloudflare Email** (`env.EMAIL`, binding nativo) — exigiria onboardar um
   domínio de envio na Cloudflare; **não configurado** (o domínio da
   organização não está nesta conta Cloudflare, e mover DNS foi descartado
   pelo risco de derrubar o Google Workspace deles).
3. **Resend** (`RESEND_API_KEY`) — fallback via HTTP, sem precisar mover DNS;
   em modo sandbox (sem domínio verificado no Resend) só entrega pro e-mail
   que criou a conta Resend.

Se nenhum estiver configurado, os e-mails ficam `pending` na fila
indefinidamente, sem erro — nenhum outro código do sistema precisa mudar
quando um provedor for trocado/adicionado (`pickProvider(env)` decide na
hora, a cada `flushOutbox`).

Pra ver quantos e-mails estão esperando: aba Notificações do Admin, ou
`GET /api/admin/settings/email-outbox`.

### Respostas por e-mail → chat do Empréstimo de Equipamentos

`server/src/lib/gmailInbox.js`. Quando o solicitante responde a uma mensagem
rápida ✉️ ou ao aviso de prazo, a resposta cai na caixa do Gmail que envia
(`GMAIL_SENDER_EMAIL`). O UniFlow lê só os e-mails com os assuntos desses
avisos (últimos 30 dias) e põe cada resposta no chat do empréstimo, sem a
parte citada. A ligação é pelo fio (threadId) do Gmail, que o envio passou a
guardar em `email_outbox.provider_thread_id`. E-mails mandados antes disso
casam por remetente + assunto.

Quando roda: no cron de 1 min, nos minutos terminados em 3 e 8 (no lugar das
filas do GLPI naquele minuto), e quando alguém abre o chat (`?check=1`, no
máximo 1 vez a cada 20 s).

Permissão de leitura, tentada nesta ordem:
1. o próprio `GMAIL_REFRESH_TOKEN`, se foi gerado com escopo de leitura
   (`gmail.readonly` ou `https://mail.google.com/`);
2. a Service Account (`GOOGLE_SA_*`) com o escopo
   `https://www.googleapis.com/auth/gmail.readonly` autorizado em Admin Console →
   Segurança → Controles de API → Delegação em todo o domínio, no mesmo Client ID
   já usado pelo Drive/Diretório. Ela entra na caixa `GMAIL_INBOX_EMAIL` (secret
   opcional) ou, se não houver, na `GMAIL_SENDER_EMAIL`.

Resultado da última rodada: `app_settings.gmail_inbox_status` (JSON com `auth`,
`ok`, `error`, `matched`).
