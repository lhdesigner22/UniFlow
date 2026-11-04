---
name: nova-aba
description: Roteiro para criar uma aba/tela/módulo NOVO no UniFlow, da ideia até a publicação — plano, banco (migração + índices), permissões por cargo, departamento, API, tempo real, auditoria, tela no visual premium, testes e deploy. Use sempre que o Luiz trouxer a ideia de uma aba, tela, página, módulo ou funcionalidade nova ("quero uma aba de...", "dá pra ter um controle de...", "cria uma tela pra...", "/nova-aba"), mesmo que ele não diga "aba". Não use para refazer o visual de uma tela que já existe (aí é frontend-design) nem para corrigir bug.
---

# Aba nova no UniFlow

O UniFlow tem regras que não aparecem lendo uma tela só: quem esquece a migração de permissão faz uma aba que só o Super Admin enxerga; quem esquece o índice estoura o limite grátis de leituras do D1; quem esquece o teste no `run-all.mjs` deixa o GitHub Actions cego. Este roteiro existe para nada disso ficar para trás. O CLAUDE.md da raiz tem o detalhe de cada regra — leia a seção correspondente quando um passo pedir.

Responda sempre em português do Brasil, em linguagem simples (o Luiz é da TI, mas quem usa a aba muitas vezes não é).

## 1. Entender a ideia (antes de qualquer código)

Transforme o pedido num plano curto e mostre ao Luiz **antes de construir**. Pergunte só o que mudar o desenho; o resto, decida e diga o que decidiu:

- **Para quem e para quê**: quem usa (TI, coordenação, colaborador?), qual problema resolve, o que a pessoa faz na tela no dia a dia.
- **Onde fica no menu**: dentro de um grupo existente (Gestão, Fluxos, Time, Impressoras, Chamados...) ou item próprio.
- **Módulo de permissão**: reaproveitar um módulo existente (ex.: dentro de `gestao`, `incidents`) ou criar um novo em `MODULES` (`server/src/lib/permissions.js`). Módulo novo só se precisar de controle próprio no Admin → Cargos.
- **Separa por departamento?** Padrão: sim (`department_id`, NULL = Geral). Não separa quando é coisa só da TI (ex.: estoque de insumos) ou tem lista própria de acesso (ex.: Cofre).
- **Dados**: o que se guarda (campos), o que é histórico, se tem foto/anexo (fotos = reduzidas no navegador e guardadas como data URL, como Incidentes), se exporta Excel.

Mostre o plano com: tabelas e campos, rotas da API, quem vê/edita, esboço da tela (ASCII serve) e a lista do que será feito. Espere o ok dele.

## 2. Banco (migração)

- Arquivo novo `migrations/NNNN_nome.sql` com o próximo número (veja o último em `migrations/`).
- **Índice nas colunas do WHERE/ORDER BY desde o início** — o banco já chegou a 2 milhões de leituras/dia por falta de índice (plano grátis: 5 M/dia, 100 mil gravações/dia).
- **Módulo novo = na mesma migração, dar o nível dele aos cargos existentes** (`json_set` em `roles.permissions`, modelo em `migrations/0054_lab_incidents.sql`). Sem isso ninguém além do Super Admin vê a aba.
- Linha do D1 tem limite de ~2 MB e a importação de backup recusa instruções muito longas: nada de guardar coisas enormes numa célula só.
- Dados sensíveis (senhas, chaves) nunca em seed do repositório.

## 3. Servidor (API)

- Rota nova em `server/src/routes/<nome>.js`, montada em `server/src/worker.js` (`app.route('/api/<recurso>', ...)`).
- O portão de acesso do worker.js já barra quem não tem o módulo; dentro da rota use os helpers de `permissions.js`: `accessOf`, `departmentFilter`, `departmentForCreate/Update`, `canSeeDepartment`, `canModifyDepartment`.
- **Plano grátis do Workers**: cada consulta ao D1 conta como subrequest (máx. 50 por chamada) e há ~10 ms de CPU. Agrupe escritas com `db.batch`; nada de consulta dentro de laço.
- Links digitados pelo usuário: validar com `lib/safeUrl.js`. Exportação: o servidor só devolve `/export?format=json` e o Excel é montado no navegador (`client/src/utils/xlsxExport.js` + `exports.js`).
- **Tempo real e auditoria vêm de graça**: toda escrita em `/api/<recurso>` já é registrada no log de auditoria e avisa os aparelhos conectados com `{ r: '<recurso>' }`. Só mexa se o recurso não deve entrar (listas `LIVE_SKIP_RESOURCES` / `AUDIT_SKIP_RESOURCES` no worker.js) ou se precisar de log com detalhe (como o Cofre).
- Se alguma escrita da rota criar notificação (`createNotification`), acrescente o recurso em `NOTIFYING_RESOURCES` do `client/src/components/layout/Topbar.jsx`.

## 4. Tela

- Página em `client/src/pages/<Nome>Page.jsx` + `.module.css`; rota em `client/src/App.jsx` dentro de `<RequireModule module="...">`; item no menu em `client/src/components/layout/Sidebar.jsx`.
- **Visual premium** (ver CLAUDE.md, seção "Visual premium"): Cases de Sucesso é a página-modelo; ícones de `components/common/LineIcon.jsx` (nunca emoji em botão); KPIs num painel só; ações secundárias no menu "⋯" (`components/common/RowMenu.jsx`); cores só pelos tokens de `index.css` (paleta do Início: azul da logo, verde, noite), nada de hex solto.
- Use a skill **frontend-design** para desenhar a tela.
- Recarregar ao vivo: `useLiveRefresh(['<recurso>'], recargaSilenciosa)` — recarga silenciosa, sem piscar "carregando".
- Acessibilidade (regras da casa): `.label` com `htmlFor` + `id`; `div` clicável = `{...pressable(fn)}`; erro `role="alert"`, status `role="status"`; lista arrastável com `useSortableSensors()` + botões de mover.
- Datas: hoje/mês atual com `todayLocalISO()` (`utils/formatDuration.js`) — `toISOString()` é UTC e depois das 21h vira o dia seguinte.
- Textos: verbo claro no botão ("Registrar empréstimo", não "Enviar"), tela vazia que diz o que fazer.

## 5. Testes (antes de pedir para ele conferir)

O Luiz não gosta de testar à mão: teste você.

- Suíte nova `server/test-e2e/<nome>-e2e.mjs` cobrindo: criar/editar/excluir, quem **não** tem o módulo leva 403, separação por departamento, e qualquer regra de negócio. **Inclua em `GROUPS` do `server/test-e2e/run-all.mjs`** (é o que o GitHub Actions roda), antes de `audit`/`security`/`download-ticket`.
- `cd server && npm test` tem que passar inteiro.
- Tela: rode o app local (node-server + Vite, ver CLAUDE.md "Teste local") e tire prints com Playwright, desktop e celular, tema escuro e claro.

## 6. Mostrar e publicar

1. Mande os prints e um resumo curto do que foi feito e do que ficou de fora.
2. Pergunte "Posso publicar?" e **só publique com o ok dele** (cada publicação é aprovada à parte).
3. `npm run release` (confere a conta da Cloudflare, backup, migração, build, deploy, produção) e depois `git push`.
4. Diga a ele: **"feche e reabra a aba"** (o app instalado guarda a versão antiga).
5. Atualize o CLAUDE.md (seção "Outras funcionalidades que existem") com a aba nova: rota, arquivos, módulo e decisões dele.

## Checklist final (confira antes do passo 6)

- [ ] Plano aprovado pelo Luiz
- [ ] Migração com índices (e `json_set` nos cargos, se módulo novo)
- [ ] Rota com permissão e departamento
- [ ] Tela no visual premium, rota em `App.jsx`, item no menu
- [ ] `useLiveRefresh` na tela (e `NOTIFYING_RESOURCES`, se notifica)
- [ ] Suíte e2e nova no `run-all.mjs`; `npm test` passando
- [ ] Prints enviados; ok para publicar; release + push; "feche e reabra a aba"
- [ ] CLAUDE.md atualizado
