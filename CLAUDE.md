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
**`npm run release`** faz tudo abaixo com checagens (conta, git limpo, backup + migração, build, deploy, confere produção).
**`npm run backup`**: export do D1 para `Documentos\UniFlow-backups` (fora do repo, 12 mais novos). Passo a passo manual:
```bash
npx wrangler whoami                         # CONFERIR a conta (já trocou sozinha pra outras contas 2x!)
npx wrangler d1 migrations apply uniflow --remote   # migração ANTES do deploy
npm run build                               # na raiz: gera client/dist
npx wrangler deploy
```
- Erro **7403** ("conta não autorizada") = wrangler logado na conta errada → `npx wrangler logout`, fechar a sessão
  do Cloudflare no navegador (ou aba anônima) e `npx wrangler login` com a conta certa. Às vezes é passageiro: tentar de novo.
- Migrações em `migrations/NNNN_*.sql` (hoje até 0064). Seeds com **dados sensíveis NÃO entram no repo** (ex: senhas de Wi-Fi das VLANs).
- Secrets (nunca no código): `JWT_SECRET`, `GLPI_APP_TOKEN`, `GLPI_USER_TOKEN`, `GOOGLE_SA_*`, `VAULT_ENCRYPTION_KEY`, Gmail/Resend etc. Variáveis públicas em `wrangler.jsonc`.

## Teste local (sem login Google)
`server/test-e2e/` tem os testes de ponta a ponta + GLPI de mentira. Veja `server/test-e2e/README.md`.
Resumo: `wrangler dev -c server/test-e2e/wrangler.test.jsonc --local --persist-to <dir> --var JWT_SECRET:testsecret`,
tokens JWT assinados com `testsecret` (payload `{id,name,email,tv:0}`), usuários inseridos direto no D1 local.
No navegador do app: `localStorage.setItem('token', ...)` em `127.0.0.1`. **Reinicie o `wrangler dev` depois de mudar código** (nem sempre recarrega).
- **Se o `wrangler dev`/`d1 --local` quebrar** com "access violation" (aconteceu em out/2026 no Windows 11 Insider 26300, qualquer
  versão do wrangler): `cd server && node test-e2e/node-server.mjs` roda o mesmo worker.js no Node com D1 em SQLite (memória,
  migrações + seeds) na porta 8799 — as suítes rodam igual. Sem tempo real nem arquivos estáticos.
- **`cd server && npm test`** (`test-e2e/run-all.mjs`) sobe o node-server e roda tudo abaixo na ordem certa — é o que o **GitHub Actions**
  roda a cada push (`.github/workflows/e2e.yml`, sem secrets, sem produção). Suíte nova = incluir em `GROUPS` do `run-all.mjs`.
  `secrets` precisa de `RATE_LIMIT=1` (limitador de mentira); `POST /__mock/sql` no node-server prepara/confere o banco.
- Suítes: `roles`, `dept`, `developments`, `lab-incidents`, `printer-supplies`, `success-cases`, `dept-modules`, `labels`, `machine-standards`, `kudos`, `audit`, `security`, `download-ticket` (nesta ordem: o `security` força novo login do analista e
  invalida o token tv:0 dele; o `download-ticket` faz o mesmo com o colaborador). `xlsx` conta linhas — rode em banco limpo (servidor recém-subido); passe uma pasta como argumento pra
  salvar os .xlsx e abrir no Excel. `entity` precisa do `mock-glpi.mjs`; `loan-replies` precisa de `MOCK_GMAIL=1`.
- **Exportações são XLSX montado no navegador** (`client/src/utils/xlsxExport.js` + `exports.js`, ExcelJS por import dinâmico, fora do
  pré-cache do PWA); o servidor só devolve `/export?format=json` (gerar no Worker estouraria os 10 ms de CPU). O CSV antigo ainda responde.

## Armadilhas do ambiente (Windows)
- Shell Bash do Claude: **evite `node -e`/heredocs com crases e `${}`** e `sed` com texto complexo — grave scripts Node em arquivo e rode,
  ou use a ferramenta de edição. Barras invertidas (`\d`, `\-`) se perdem em heredoc→JS: regex só pela ferramenta de edição.
  Python 3.15 em `/c/Python315/python` (o `python3` do PATH é um stub da Store); python-pptx instalado. Sem LibreOffice: renderizar .pptx pelo PowerPoint via COM (PowerShell).
- `npm audit fix` no `server/` sobe o wrangler — não use; atualize só o pacote necessário (ex: `npm install hono@x`).
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

## Segurança (revisão de out/2026) — decisões do Luiz
- **Login só pelo Google**, domínios fixos no código: `colegioser.com`, `fecaf.com.br`, `pro.fecaf.com.br` (`ALLOWED_LOGIN_DOMAINS`
  em `routes/auth.js`; o secret `ALLOWED_DOMAIN` não é mais lido) + `email_verified`. `/login` e `/register` respondem 410.
- Sessão revogável: o portão do worker.js (e o `auth` nos recursos que ele pula) compara `tv` do token com `users.token_version`
  e barra usuário excluído — "Forçar novo login" corta na hora.
- **CSP sem script inline**: `client/public/_headers` (estáticos) + middleware no worker.js (API). Script novo no `index.html` vai
  em arquivo de `public/`. Domínio externo novo (fetch, iframe, fonte) precisa entrar na CSP do `_headers`.
- Links digitados viram `<a href>`: validar no servidor (`lib/safeUrl.js`: `normalizeLink`, ou `isScriptLink` no Cofre) e no front
  (`utils/safeHref.js`). CSV exportado usa `lib/csv.js` (neutraliza fórmula). Portão do KB: com id na rota vale a categoria do artigo.
- Downloads de anexo: **ticket de 60s** em `?ticket=` (`lib/requestToken.js`, `POST /api/auth/download-ticket`, preso ao caminho, só GET);
  `?token=` com o token de login NÃO é mais aceito (out/2026).
- **Limite de tentativas** (`lib/rateLimit.js`, `ratelimits` no wrangler.jsonc): login 60/min por IP (a escola sai por um IP só),
  ver/copiar senha (Cofre/VLANs) e ticket de download 30/min por pessoa → 429. Não é na API toda (o tempo real faz muita leitura).
  O workers.dev não tem zona, então as regras de rate limit do painel (WAF) não servem — por isso é no código.
- Pendente (não feito): `react-router` 7 (corrige o redirecionamento aberto do audit) / `vite` 8. Avisos "altos" do `npm audit` no servidor vêm do `@cloudflare/puppeteer` (pacotes Node que não rodam no Worker).

## Permissões (cargos × departamentos) — decisões do Luiz
- **Cargos configuráveis** (tabela `roles`, Admin → aba Cargos): por módulo `none|view|edit` + escopo `all|department`.
  Módulos em `server/src/lib/permissions.js` (`MODULES`): boards, agenda, metrics, team, tickets, kb, gestao, approvals,
  purchases, printers, loans, companies, incidents. **Módulo novo = migração que dá o nível dele aos cargos existentes**
  (`json_set` em `roles.permissions`, ver 0054) — sem isso ninguém além do Super Admin enxerga. Cargos iniciais: Super Admin, Gestor, Analista, Colaborador, Auditor.
  Quem já existia virou Analista (mesmo acesso de antes); **quem entra novo recebe o cargo padrão** (Admin → Cargos → 🚪
  "Tornar este o cargo padrão"; `app_settings.default_role_id`, nunca Super Admin/Auditor; gravado em `users.role_id` no 1º login
  em `auth.js` — mudar o padrão não mexe em quem já existe). Sem departamento = só vê o "Geral".
- **O que cada departamento enxerga** (Admin → Departamentos → "👁 O que aparece", `departments.module_limits`): TETO por módulo
  (`none`/`view`; ausente = conforme o cargo) aplicado em `loadAccess` — vale o menor entre cargo e departamento, nunca amplia.
  Super Admin/Auditor não são afetados. Teste: `dept-modules-e2e.mjs` (o node-server tem login Google de mentira: `/__mock/google-token`).
- `users.system_role` (`super_admin|auditor|user`) continua mandando no código antigo (51 checagens); o cargo define o system_role. Super Admin/Auditor
  sempre valem mais que a tabela (ninguém se tranca fora). Nunca deixar o sistema sem Super Admin.
- **Departamentos separam o conteúdo** (`department_id` nas tabelas; NULL = "Geral", todos veem). Uma pessoa = um departamento, independentes.
  Helpers em `permissions.js`: `accessOf`, `departmentFilter`, `departmentForCreate/Update`, `canSeeDepartment`, `canModifyDepartment`.
  Fora da separação (de propósito): quadros/cartões (dono+membros), aprovações (participantes), Cofre/VLANs (lista própria `vault_access`).
  Compras: participante (quem pediu/aprovador) sempre enxerga. Time (Desempenho/Jornada): departamento vem da pessoa.
- Quem tem escopo `all` usa **"Ver como departamento"** (Topbar → header `X-Department-View`): só estreita listas, nunca amplia acesso.
- **Chamados por entidade do GLPI**: `departments.glpi_entity_name` (TI = "SERVICE DESK"); resumos por entidade em `glpi_backlog_snapshot`/
  `glpi_total_*` com id `entity:<nome>`; `lib/glpiEntities.js`. Departamento sem entidade não vê chamados.
  Dashboard do Backlog por entidade: os status 10/13–17 (Compras, Manutenção, RH, Desligamento, Inventário, Eventos) são **filas do TI** —
  os cartões delas só aparecem no SERVICE DESK (ou se a fila tiver chamado). Todo departamento tem "Alta prioridade", "Parados há +30
  dias" e o gráfico **por categoria** (campo 7 do GLPI, só na busca do Backlog — o Total não traz categoria pra não estourar 2 MB).
  **Técnicos ocultos** nos gráficos "por técnico" (Total e Backlog): botão "👁 Técnicos" (só Super Admin), por entidade, em
  `app_settings.glpi_hidden_techs`; some do gráfico e do filtro, mas os chamados continuam nos totais e na tabela.

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
  **Respostas por e-mail entram no chat** (`lib/gmailInbox.js`, ver docs/INTEGRACOES.md): lê a caixa do Gmail nos minutos x3/x8 do
  cron de 1 min (ANTES do Backlog — depois dele a leitura falhava na maioria das rodadas) + recuperação: se a última leitura tem
  +7 min, o minuto seguinte relê; e ao abrir o chat. Status em `app_settings.gmail_inbox_status`. Bolinha vermelha no ✉️ = resposta nova. Teste: `MOCK_GMAIL=1 node test-e2e/node-server.mjs` +
  `loan-replies-e2e.mjs`.
- Desempenho (estrelas/luas — 👎 privado: quem recebeu + Super Admin), Jornada, Organograma, Impressoras (drag-and-drop), Compras por mês,
  Aprovações (trocar decisão), Cofre de Senhas (AES-GCM), **VLANs** (Gestão; senhas de Wi-Fi no banco **cifradas** como o Cofre — `password_enc/iv`, migração 0063; texto puro
  em `password` vindo de seed é cifrado e apagado pela rota ao abrir a tela/mostrar; não no repo; acesso = lista do Cofre).
- **Gestão → Desenvolvimentos** (`routes/developments.js`, `DevelopmentsPage.jsx`, módulo `gestao`): vitrine dos sistemas da equipe
  (logo, para que serve, link, situação). Logo reduzida a 256 px no navegador e guardada como data URL no D1 (sem SVG). O menu lateral
  lista cada um (`GET /developments?menu=1`, sem as logos). Etiquetas dos quadros: criar/editar pelo próprio cartão (CardModal).
- **Fluxos → Incidentes Laboratórios** (`routes/labIncidents.js`, `LabIncidentsPage.jsx`, módulo `incidents`, por prédio SEDE/CENTRO/G5):
  defeito, sinistro, projeção/TV, organização, rede; gravidade; data/hora da ocorrência (horário de Brasília, texto `YYYY-MM-DDTHH:MM`);
  situação aberto → em andamento → resolvido (+ solução, quem/quando). Até 10 fotos, reduzidas no navegador (`utils/imageResize.js`) e
  guardadas como data URL em `lab_incident_photos` (miniatura na lista, grande sob demanda — sem `?token=` na URL). Exporta Excel.
  Registra/muda situação: quem tem `incidents=edit`; editar dados/excluir: quem registrou ou Super Admin.
- **Impressoras → Estoque de insumos** (`routes/printerSupplies.js`, `PrinterSuppliesPage.jsx`, rota `/estoque-insumos/:location`, módulo
  `printers`, sem separação por departamento — é estoque da TI): catálogo (tipo, cor, código, modelos compatíveis), saldo e mínimo **por
  prédio** em `printer_supply_stock` (não soma o histórico), histórico em `printer_supply_movements` (entrada, troca NA impressora,
  transferência, ajuste). Movimento grava saldo + histórico na mesma transação com trava otimista (`quantity = esperado` + `changes()`):
  concorrência dá 409, nunca saldo negativo. Consumo = trocas dos últimos 90 dias ÷ 3; cartão da impressora tem "🧴 Histórico de insumos".
- **Telão PARISFE** (`/parisfe`, pública, sem login — pra TV): 2ª entrada do Vite (`client/parisfe.html` + `src/parisfe/`), fora do app
  React e do pré-cache do PWA (Three.js ~580 KB). Logo UniFECAF em 3D (`logo3d.js`, Three.js + bloom, desenhada do mesmo caminho SVG)
  gira e troca de lado com a rolagem; abertura + 7 valores + encerramento, uma tela cada. Modo TV: sem ninguém mexer, 9 s por seção e
  volta ao início; espaço pausa, F tela cheia. Textos dos valores só em `VALUES` do `main.js`.
  Visual (out/2026, skill frontend-design): fundo azul profundo `#061826` (cena 3D `0x01070d` — o tone mapping clareia, cor mais clara
  deixa a logo marinho parecendo preta), uma família só **Bricolage Grotesque** (o Bodoni de fio fino sumia/serrilhava na TV), abertura =
  acróstico (letra grande + valor embaixo, clicável), frase de atendimento num **balão de conversa**, letra de fundo cheia e suave.
  **O Início do app É o telão** (out/2026, pedido do Luiz): `DashboardPage.jsx` = iframe de `/parisfe?embed=1` (por isso o `_headers`
  tem `frame-src 'self'`, `frame-ancestors 'self'` e `X-Frame-Options: SAMEORIGIN`) + faixa do cronômetro rodando; "Meus cartões" e
  a grade de princípios saíram. Nitidez: o EffectComposer usa alvo com MSAA (`samples: 4`) — sem isso o pós-processamento perde o
  antialias e serrilha; dithering no fim contra faixas no degradê escuro. Prints: o painel do navegador para de desenhar com o app em 2º plano — usar Playwright (chrome headless).
- **Gestão → Cases de Sucesso** (`routes/successCases.js`, `SuccessCasesPage.jsx`, rota `/gestao/cases-de-sucesso`, módulo `gestao`, sem
  separação por departamento): vitrine das entregas da TI no ano **para apresentar à diretoria (C-Level)** — linguagem simples, cada case =
  antes → o que fizemos → resultado; detalhe técnico recolhido (nada de IP/senha). Pilares: conectividade, segurança, gestão, operação.
  Número em destaque: o digitado vale mais que o "ao vivo" (`GET /stats`: chamados do GLPI, empréstimos do ano...). Até 6 fotos (como
  Incidentes). "Modo apresentação": tela cheia, capa + um case por tela, setas do teclado. Os 12 cases de 2026 vieram na migração 0057
  (textos iniciais deduzidos pelo nome — o Luiz ajusta pela tela). Catracas: o servidor passou a ser **local e administrado pela TI**.
  **Save financeiro** (migração 0061: `saving_value` em R$, `saving_period` unico|mensal|anual|meses36, `saving_note`): aba no editor do case,
  aba "💰 Save financeiro" na página (tabela + total) e KPI "Save financeiro" = soma dos valores (só o mensal × 12; "Em 36 meses" =
  valor do contrato inteiro, sem dividir). Aparece por último na capa da apresentação (depois dos chamados).
  **Baixar PPTX/PDF** (botões no topo): `utils/casesDeck.js` monta no navegador (pptxgenjs + pdf-lib, import dinâmico, fora do
  pré-cache — `manualChunks` dá nome ao `pdf-lib` pro `globIgnores` pegar). Um layout só em polegadas (16:9) desenhado pelos dois
  formatos; Arial/Helvetica, texto longo cortado com "…", mesmos cases/filtro do modo apresentação, fotos = miniaturas.
- **Base de Conhecimento → Padronização de máquinas** (`routes/machineStandards.js`, `components/kb/MachineStandards.jsx`, aba própria
  dentro de `KnowledgeBasePage`, recurso `/api/machine-standards` no módulo `kb`, sem departamento): processador/RAM/extra mínimos por
  **cargo** e exceções por **setor** (o setor vale para qualquer cargo dele). Os 5 perfis da apresentação vieram na migração 0060.

## Visual "premium" (out/2026)
- Referências: site da Gcore (pedida pelo Luiz) + Linear (skill awesome-design-md), **mantendo as cores do UniFlow** (azul `--brand` + verde).
  Tema escuro em **grafite** (`--bg #111318`; o quase-preto ele achou escuro demais), bordas brancas a 9%, brilho azul no `body` (`.main`,
  Topbar e menu transparentes/no mesmo fundo), item ativo do menu = degrau de cinza (sem azul), títulos h1/h2 peso 600 com tracking negativo,
  botões `.btn` em pílula (todos os temas), login no estilo Gcore (`Auth.module.css`).
- **Cases de Sucesso é a página-modelo**: ícones de linha (SVG) no lugar de emoji, KPIs num painel só dividido por linhas, cartões neutros
  (bloco "Acabamento premium" no fim do `.module.css`). Já aplicado também em Início (Dashboard), Backlog, Total de Chamados, Compras e
  Empréstimos; ícones de ação em `components/common/LineIcon.jsx` (usar no lugar de emoji). Outras telas: aplicar o mesmo tela a tela.
  **Admin** (out/2026, skills design-critique + design-taste-frontend): título "Administração" com o retrato do acesso embaixo, abas sublinhadas
  sem emoji, aba Usuários = `components/admin/UsersTab.jsx` (tabela real, busca, filtros por cargo/departamento, ações no menu "⋯").
  Abas Cargos/Departamentos/Notificações/GLPI refeitas (out/2026, skill frontend-design): uma frase `.lead` no lugar da caixa azul "Como
  funciona", Cargos = lista à esquerda + editor, permissões num seletor de 3 posições (`components/admin/LevelSwitch.jsx`, rádios de
  verdade — também no modal "O que aparece"), Departamentos = tabela com linha de criar, GLPI/Notificações = painel com linhas.
  `?tab=` abre qualquer aba do Admin.
  **Base de Conhecimento** refeita (out/2026): estante de leitura — lista com busca (destaca o termo) à esquerda, artigo inteiro à
  direita; texto pronto aparece como bloco de resposta com "Copiar texto" em destaque; no celular, lista → toca → artigo (com "Voltar").
  Categorias em abas sublinhadas; Padronização de máquinas = tabela comparativa por cargo/setor (o seletor de emoji saiu do editor,
  fica só a cor; o campo `icon` continua no banco).
  **Impressoras** refeita (out/2026): inventário em tabela com abas por prédio na própria tela, IP = botão de copiar, driver/link/histórico
  na linha, ordem com alça + ↑ ↓, editar/excluir no menu "⋯" (`components/common/RowMenu.jsx`, menu reutilizável). **Estoque de insumos**:
  abas sublinhadas, KPIs num painel só (o "No mínimo" filtra), linha com só "Trocar" e "Entrada" + o resto no "⋯", saldo baixo = ponto
  vermelho (sem pintar a linha).
  **Agenda** refeita (out/2026): "Semana" = linha do tempo dos 7 dias (dia em número grande, hoje com a linha "Agora, HH:MM" entre o que
  passou — esmaecido — e o que vem; dia vazio = "Nada marcado"); "Mês" = painel único dividido por linhas, hoje num círculo azul, no
  celular os eventos viram pontos. `isoDate` passou a usar a data LOCAL (com `toISOString`, depois das 21h de Brasília "hoje" virava
  amanhã).
  **Aprovações** refeita (out/2026): "Recebidas" em "Esperando você" + "Já decididas por você" ("Enviadas": "Em andamento" + "Concluídas");
  cada linha com prazo em linguagem de gente (`dueInfo`: "Venceu ontem" em vermelho) e as "assinaturas" (`SignOffs`: avatar de cada
  aprovador com ✓/✗/relógio + "1 de 2 aprovaram" ou "Fulano reprovou"); detalhe com botões grandes Aprovar/Reprovar. Botão = "Pedir aprovação".
  **Fila da crítica das 5 telas concluída** (Admin, KB, Impressoras, Agenda, Aprovações).
  **Incidentes Laboratórios** refeita (out/2026): KPIs num painel, situação em abas (Pendentes = não resolvidos, Abertos, Em andamento,
  Resolvidos, Todos), lista em linhas com foto/ícone do tipo (`INCIDENT_CATEGORIES[].icon` = nome do `LineIcon`), "hoje, 08:40" e a
  gravidade como escala de 4 barras (`Severity`); detalhe com o andamento em passo a passo + "Começar atendimento", "Marcar como
  resolvido", "Reabrir", "Salvar anotação".
  **Cofre de Senhas e VLANs** refeitos (out/2026): senha = `components/common/SecretField.jsx` (bolinhas + Mostrar/Copiar, cada clique
  pede ao servidor com `purpose` → log; mostrada, uma barra esvazia nos 30 s até esconder). Cofre = lista agrupada por categoria, editar/
  excluir no "⋯" (`RowMenu`), aviso de que mostrar/copiar fica no histórico. VLANs: títulos em caixa normal, observações em cinza neutro.
  Para testar o Cofre/VLANs local: o node-server novo tem `/__mock/sql` (o de 3001 antigo não tinha) — VLANs não têm seed no repo, use dados fictícios.
  **Time → Desempenho** refeito (out/2026): equipe em linhas (👍/👎, "Reconhecer", "Apontar ponto de melhoria", histórico, "Tirar do quadro"
  no "⋯") + **Mural de reconhecimentos** (`GET /api/team-kudos/recent`: últimos 12, SÓ estrelas — a lua/👎 é privada e nunca entra;
  suíte `kudos-e2e.mjs` garante isso). Migração 0064 = índices de `team_kudos_events` (não tinha nenhum).
  **Time → Organograma** refeito (out/2026): prancheta pontilhada que rola nos dois sentidos e abre centralizada no topo; caixa = iniciais
  coloridas + nome + cargo (topo com filete azul); ações (subordinado, ligar, voltar ao lugar, editar, excluir) em ícones que aparecem no
  hover/foco (sempre no toque, `@media (hover: none)`; no modo "ligar" aparecem em todas). Arrastar/linhas/ligações/linhas soltas iguais.
  **Time → Jornada** refeita (out/2026): pessoas em fichas no topo (com nº de marcos, atualiza ao mexer), pessoa aberta com resumo
  "N marcos desde <mês> de <ano>", linha do tempo VERTICAL agrupada por ano (ano grande = capítulo) + História ao lado (embaixo no
  celular); editar/excluir marco no hover, "Tirar da Jornada" no "⋯". Meses em minúscula (antes saía "Fev De 2022").
- **Auditoria /design-system (out/2026, nota 58/100)**: foco do teclado feito (`:focus-visible` com tag em `index.css`, vence
  `all: unset` dos módulos). Cores (1ª etapa feita): hex/rgba com o MESMO valor de um token viraram `var(--x)` / `color-mix(in srgb, var(--x) N%, transparent)`
  (146 trocas, telas idênticas); texto de situação por tema em `--info-text/--success-text/--danger-text/--warning-text/--purple-text`
  (etiquetas `.badge-*` usam); `--font-mono` definido. Pendentes: ~185 cores fixas no CSS (pares claro/escuro por tela) e 119 no JSX; aliases duplicados (`--white`/`--text`, `--blue`/`--brand`,
  `--navy2`/`--surface`); componentes repetidos por tela (KPI ×5, tabela ×6, chips ×6, vazio ×28).
  **Varredura ui-ux-pro-max (out/2026)**: rótulo `.label` sempre com `htmlFor` + `id` no campo (componente reutilizado usa `useId`);
  `div`/`span` clicável = `{...pressable(fn)}` (`utils/pressable.js`, Enter/Espaço); lista arrastável = `useSortableSensors()` +
  `accessibility={sortableAccessibility(...)}` (`utils/sortableA11y.js`) + botões ‹ › de mover; mensagem de erro `role="alert"`, de status `role="status"`.
  Pendentes da varredura: título da aba fixo "UniFlow", 2 `window.confirm` no Admin, escala de fonte (21 tamanhos), alvos < 24px, `transition: all`.
  Prints locais com o Playwright CLI (`%APPDATA%\npm\playwright-cli.cmd`: `open`, `localstorage-set token ...`, `goto`, `screenshot --filename`).
  Ele roda pelo cmd: `&` na URL corta o resto e `=>` num `eval` vira redirecionamento (cria arquivos lixo na pasta) — use URLs sem `&`
  e `snapshot` pra esperar. Auditoria a11y local: `npm install --no-save axe-core` no client (some quando o npm reinstala).

## Logs de auditoria (out/2026) — pedido do Luiz: controle maior do Cofre
- Tabela `audit_logs` (migração 0062), `lib/audit.js`, `routes/audit.js`, tela **Admin → 🕵️ Logs** (`components/admin/AuditLogTab.jsx`;
  textos em `utils/auditLabels.js`; Excel em `exports.js → exportAuditXlsx`). Ler: só Super Admin e Auditor. **Não existe editar/apagar log.**
- O que entra: (1) middleware no worker.js ANTES do portão de acesso — toda escrita (POST/PUT/PATCH/DELETE), inclusive as recusadas
  (401/403 = "Atenção"), e GET de `.../export`; (2) cada tela aberta (`POST /api/audit/view` do `AppLayout`, 30 s sem repetir; o Auditor
  pode, é exceção do só-leitura); (3) login/negado (`auth.js`) e saída (`POST /api/audit/logout`); (4) **Cofre e VLANs com detalhe**: abrir
  (1 a cada 5 min), ver e copiar senha (`?purpose=show|copy`, gravado com await ANTES de decifrar — sem log, sem senha), criar/editar
  (só NOMES dos campos)/excluir, dar/tirar acesso, tentativa sem autorização ("Crítico").
- Alertas no sininho dos Super Admins: 10 senhas vistas/copiadas por uma pessoa em 10 min (1 aviso por rajada); tentativa sem acesso ao
  Cofre (1 por pessoa por hora). No Cofre/VLANs a senha não fica guardada na tela e se esconde sozinha em 30 s.
- Nunca grava senha nem corpo de requisição. Retenção (cron de 15 min às 03:00 de Brasília): telas 90 dias; alterações/logins/exportações
  1 ano; Cofre nunca apaga. IP vem de `CF-Connecting-IP` (local fica "—"). `audit` fica fora do tempo real (LIVE_SKIP).

## Desempenho do banco (estudo de out/2026)
- Banco pequeno (~9 MB, ~8,5 mil linhas), mas lia **~2 milhões de linhas/dia** (40% do limite Free de 5 M/dia) por falta de índice —
  o sininho sozinho era 57%. Migração 0055 criou os índices (sininho 259 → 0 linhas por consulta). Medir: `wrangler d1 info uniflow`
  e `wrangler d1 insights uniflow --sort-by reads`. **Tabela nova = índice nas colunas do WHERE/ORDER BY desde o início**, e contadores
  do menu só no carregamento + tempo real (não a cada navegação).

## Estado / pendências conhecidas
- Tudo acima está em produção. Ainda **sem uso real confirmado pelo Luiz**: limpeza de duplicatas em massa de feriados, cargos/departamentos
  (cadastrar o 2º departamento e mover pessoas), entidades por departamento (Admin → Departamentos → "Entidade do GLPI").
- Limite a vigiar: cache cru do Total (`glpi_total_raw`, limite de linha do D1: 2 MB). Chegou a 1,95 MB (8,6 mil chamados) em out/2026 →
  formato compacto v2 (`encodeRaw`/`decodeRaw` em `glpiTotalSync.js`: chamado = array, origem/técnicos = índices) caiu p/ ~0,9 MB; a
  cópia `'current'` do cache cru deixou de existir (só o resumo `'current'` continua). Cresce ~110 bytes por chamado.
  **Aviso automático**: passou de 1,5 milhão de caracteres, os Super Admins recebem no sininho (1/dia; `alertRawSize`).
- **Total de Chamados → "Chamados por origem da requisição"**: campo 9 do GLPI (Origem da requisição), só no Total (`withOrigin`);
  ranking do período (vale o filtro De/Até) + mês a mês das 6 maiores (resto em "Outras"). Decisão do Luiz: o "setor" é a Origem da requisição;
  botão "Só setores" (ligado por padrão) esconde os canais Helpdesk, E-Mail e Sem origem (`isChannelOrigin`, `sectorSeries`/`sectorMonthly`).
- Ideias não feitas: cartão aberto (CardModal) ao vivo; eventos do GLPI por departamento/entidade;
  descobrir quem cria chamados de feriado em massa.
