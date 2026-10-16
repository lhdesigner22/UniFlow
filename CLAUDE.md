# UniFlow — memória do projeto (para o Claude Code)

Este arquivo é lido automaticamente a cada sessão. Ele guarda o que **não dá pra
descobrir lendo o código**: como trabalhar com o usuário, armadilhas já
resolvidas, decisões tomadas e o estado do projeto. Atualize-o quando algo
importante mudar. Documentação técnica longa: `docs/` (comece por
`docs/ARQUITETURA.md`) e `README.md`.

## Quem e como trabalhar
- Dono: **Luiz Sanchez** (`luiz.sanchez@colegioser.com`), Super Admin, equipe de TI do
  Colégio SER / UniFECAF. Fala **português do Brasil** — responda sempre em português.
- Prefere resultado rápido e verificado. Já reclamou de demora e de ter que testar tudo
  à mão: **teste você mesmo** (testes locais abaixo) antes de pedir pra ele conferir, e
  diga sempre "feche e reabra a aba" depois de um deploy (PWA/service worker guarda a versão antiga).
- Peça confirmação antes de ações que escrevem em sistemas externos de produção (GLPI,
  e-mail em massa) — ele já autorizou algumas explicitamente (solucionar duplicatas).
- Nunca extraia credenciais de sites de terceiros. Não consigo logar no app (login Google):
  testo com tokens JWT assinados localmente contra o Worker local.

## Produção
- App: https://uniflow.serfecaf.workers.dev (Cloudflare Workers + D1 + assets do Vite). Repo: `lhdesigner22/UniFlow`, branch `main`.
- **Plano Workers FREE**: 50 subrequests por execução (cada consulta ao D1 conta!), ~10 ms de CPU,
  5 crons por conta (todos usados), Browser Rendering 10 min/dia. Isso moldou o código (lotes, `db.batch`, filas por cron).
- Banco D1 chama `uniflow`. Conta Cloudflare correta: **luiz.sanchez@colegioser.com** (account `8c6d…`).

### Deploy (sempre nesta ordem)
```bash
npx wrangler whoami                         # CONFERIR a conta (já trocou sozinha pra outras contas 2x!)
npx wrangler d1 migrations apply uniflow --remote   # migração ANTES do deploy
npm run build                               # na raiz: gera client/dist
npx wrangler deploy
```
- Erro **7403** ("conta não autorizada") = wrangler logado na conta errada → `npx wrangler logout`, fechar a sessão
  do Cloudflare no navegador (ou aba anônima) e `npx wrangler login` com a conta certa. Às vezes é passageiro: tentar de novo.
- Migrações em `migrations/NNNN_*.sql` (hoje até 0051). Seeds com **dados sensíveis NÃO entram no repo** (ex: senhas de Wi-Fi das VLANs).
- Secrets (nunca no código): `JWT_SECRET`, `GLPI_APP_TOKEN`, `GLPI_USER_TOKEN`, `GOOGLE_SA_*`, `VAULT_ENCRYPTION_KEY`, Gmail/Resend etc. Variáveis públicas em `wrangler.jsonc`.

## Teste local (sem login Google)
`server/test-e2e/` tem os testes de ponta a ponta + GLPI de mentira. Veja `server/test-e2e/README.md`.
Resumo: `wrangler dev -c server/test-e2e/wrangler.test.jsonc --local --persist-to <dir> --var JWT_SECRET:testsecret`,
tokens JWT assinados com `testsecret` (payload `{id,name,email,tv:0}`), usuários inseridos direto no D1 local.
No navegador do app: `localStorage.setItem('token', ...)` em `127.0.0.1`. **Reinicie o `wrangler dev` depois de mudar código** (nem sempre recarrega).

## Armadilhas do ambiente (Windows)
- Shell Bash do Claude: **evite `node -e`/heredocs com crases e `${}`** e `sed` com texto complexo — grave scripts Python/Node em arquivo e rode.
  Python real: `C:\Users\Luiz\AppData\Local\Programs\Python\Python314\python.exe` (o `python` do PATH é um stub da Store).
- `cd` no Bash persiste entre comandos e muda o diretório de trabalho — use caminhos absolutos ou `cd` explícito.
- `wrangler d1 execute --command` com várias linhas falha em silêncio → use `--file`.
- `wrangler tail --format json` (o `pretty` esconde `console.log`).
- Esbuild: `keep_names:false` em `wrangler.jsonc` (senão `page.evaluate` do Browser Rendering quebra com `__name`).

## Arquitetura em 1 minuto
- `server/src/worker.js`: monta tudo. Middlewares em ordem: db → **portão de acesso por cargo** (carrega `c.get('access')`, bloqueia
  módulo sem permissão/só-leitura, trava do Auditor) → **broadcast em tempo real** → rotas `/api/*`. `scheduled()` roda os crons.
- Crons (`wrangler.jsonc`): `* * * * *` Backlog + filas GLPI (`processGlpiQueues`); `*/15` SLA, resumos, sync de Eventos, e-mails;
  `5,20,35,50` cache de técnicos; `10,25,40,55` Total de Chamados; `0 12 * * SUN` grade de salas (Browser Rendering).
- Frontend `client/src`: React+Vite, estilos em CSS Modules, estado com zustand (`store/`), `services/api.js` (axios; manda
  `X-Client-Id` e `X-Department-View`), `hooks/useLiveRefresh.js`.

## Permissões (cargos × departamentos) — decisões do Luiz
- **Cargos configuráveis** (tabela `roles`, Admin → aba Cargos): por módulo `none|view|edit` + escopo `all|department`.
  Módulos em `server/src/lib/permissions.js` (`MODULES`): boards, agenda, metrics, team, tickets, kb, gestao, approvals,
  purchases, printers, loans, companies. Cargos iniciais: Super Admin, Gestor, Analista, Colaborador, Auditor.
  Quem já existia virou Analista (mesmo acesso de antes); **quem entra novo vira Colaborador** (sem departamento = só vê o "Geral").
- `users.system_role` (`super_admin|auditor|user`) continua mandando no código antigo (51 checagens); o cargo define o system_role. Super Admin/Auditor
  sempre valem mais que a tabela (ninguém se tranca fora). Nunca deixar o sistema sem Super Admin.
- **Departamentos separam o conteúdo** (`department_id` nas tabelas; NULL = "Geral", todos veem). Uma pessoa = um departamento, independentes.
  Helpers em `permissions.js`: `accessOf`, `departmentFilter`, `departmentForCreate/Update`, `canSeeDepartment`, `canModifyDepartment`.
  Fora da separação (de propósito): quadros/cartões (dono+membros), aprovações (participantes), Cofre/VLANs (lista própria `vault_access`).
  Compras: participante (quem pediu/aprovador) sempre enxerga. Time (Desempenho/Jornada): departamento vem da pessoa.
- Quem tem escopo `all` usa **"Ver como departamento"** (Topbar → header `X-Department-View`): só estreita listas, nunca amplia acesso.
- **Chamados por entidade do GLPI**: `departments.glpi_entity_name` (TI = "SERVICE DESK"); resumos por entidade em `glpi_backlog_snapshot`/
  `glpi_total_*` com id `entity:<nome>`; `lib/glpiEntities.js`. Departamento sem entidade não vê chamados.

## GLPI
- Eventos (status 17 "Eventos") → Agenda (`lib/glpiSync.js`, parsers em `glpiParser.js`). Importa em **lotes** (≤30 por rodada; flag
  `glpi_import_pending` faz o cron de 1 min continuar). Departamento dos eventos importados: `app_settings.glpi_department_id`.
- **Duplicatas** (`glpiDuplicates.js`, `glpiDuplicateSolver.js`): mesmo título normalizado ("Nova Reserva -", "(…)", "- Feriado" ignorados) +
  mesma data + **horários que se sobrepõem**; **a sala NÃO conta** (feriado chega com 1 chamado por sala). Fica o menor número; os outros são
  solucionados no GLPI ("Chamado duplicado. Tratado no chamado #X") e saem da Agenda; salas somadas na descrição do que fica.
  Novos repetidos nem viram evento (`glpi_duplicate_tickets`). Botões em Admin → GLPI; opção permanente `glpi_dup_auto`
  (desligada por padrão). "Solucionar retroativos": eventos que já passaram.
- Chamados de feriado em massa (centenas, 2 levas de horário) são criados por algum sistema de reservas — origem ainda não investigada.

## Outras funcionalidades que existem (para não reinventar)
- **Tempo real**: Durable Object `LiveHub` (`lib/liveHub.js`) + WebSocket; middleware faz broadcast `{r: recurso}` após qualquer escrita;
  telas usam `useLiveRefresh(['recurso'], recargaSilenciosa)`. Ticket de 60 s assinado com chave separada (`JWT_SECRET:live`).
- **Empréstimo de Equipamentos** (SEDE/CENTRO/G5): inventário com patrimônio, vários itens por reserva, grade de salas (copiada do site de
  horários por Browser Rendering; botão/cron de domingo), e-mail do solicitante só `@fecaf.com.br`, `@pro.fecaf.com.br`, `@colegioser.com`
  (busca no diretório do Google Workspace), aviso de prazo (manhã até 10h/noite até 22h), mensagem rápida por e-mail, coluna "Registrado por".
- Desempenho (estrelas/luas — 👎 privado: quem recebeu + Super Admin), Jornada, Organograma, Impressoras (drag-and-drop), Compras por mês,
  Aprovações (trocar decisão), Cofre de Senhas (AES-GCM), **VLANs** (Gestão; senhas de Wi-Fi no banco, não no repo; acesso = lista do Cofre).

## Estado / pendências conhecidas
- Tudo acima está em produção. Ainda **sem uso real confirmado pelo Luiz**: limpeza de duplicatas em massa de feriados, cargos/departamentos
  (cadastrar o 2º departamento e mover pessoas), entidades por departamento (Admin → Departamentos → "Entidade do GLPI").
- Limite a vigiar: cache cru do Total (`glpi_total_raw`) ~1,3 MB p/ SERVICE DESK (limite de linha do D1: 2 MB).
- Ideias não feitas: cartão aberto (CardModal) ao vivo; eventos do GLPI por departamento/entidade; criptografar senhas de Wi-Fi como o Cofre;
  descobrir quem cria chamados de feriado em massa.
