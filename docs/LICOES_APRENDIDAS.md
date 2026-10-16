# Lições aprendidas / bugs já resolvidos

Isto é o histórico de "por que o código está assim e não do outro jeito
mais óbvio". Ler antes de "simplificar" algo que parece estranho à primeira
vista — várias dessas coisas já foram feitas do jeito óbvio uma vez, e
quebraram em produção.

## Rotas com prefixo fixo precisam vir ANTES de rotas com `:param`

**Sintoma real**: o botão de reordenar Links de Internet nunca persistia — a
tela sempre voltava pra ordem alfabética depois de arrastar.

**Causa**: em `server/src/routes/internetLinks.js`, `PUT /:id` estava
registrado ANTES de `PUT /reorder`. Como o Hono (igual Express) casa rotas
pela ordem de registro, uma chamada a `PUT /internet-links/reorder` batia
primeiro em `PUT /:id` (tratando `"reorder"` como um id literal), retornava
404, e o front-end desfazia o arrasto recarregando a lista original.

**Correção**: mover a rota mais específica (`/reorder`) pra ANTES da rota
genérica (`/:id`) no arquivo. Se for adicionar uma rota nova com um sufixo
fixo (tipo `/algo/reorder`, `/algo/bulk`) num arquivo que já tem `PUT /:id`
ou `DELETE /:id`, ela tem que vir antes.

## Timestamp do banco não tem `Z` — não dá pra usar `new Date(str)` direto

Toda coluna `created_at`/`updated_at` do D1 é `datetime('now')`, que grava em
**UTC sem sufixo `Z`** (tipo `"2026-09-21 14:30:00"`). `new Date()` do
JavaScript, sem `Z`, assume **horário local** — erra o fuso silenciosamente
(mostra hora errada, sem crashar, o que é pior que um erro óbvio). Sempre usar
`parseDbTimestamp` (`client/src/utils/formatDuration.js`), que já trata isso.
Bug revisitado várias vezes nesta sessão até esse helper ficar consistente em
todo lugar que exibe data/hora.

## `@keyframes` não são isoladas por CSS Modules neste build

Descoberto ao investigar por que `MetricsPage.module.css` conseguia usar
`animation: shimmer ...` sem nunca declarar `@keyframes shimmer` — a
animação está definida uma vez em `client/src/index.css` (global) e
referenciada por nome de qualquer `.module.css`, sem import. Isso é usado de
propósito (evita duplicar a mesma animação em 10 arquivos), mas quer dizer
que **declarar** um `@keyframes` com um nome que já existe em outro lugar do
projeto sobrescreve ele globalmente (o último no bundle final "ganha"), não
fica isolado por módulo como uma classe CSS ficaria. Ao adicionar uma
animação nova, ou reusa um nome já existente em `index.css`, ou escolhe um
nome que claramente não colide (foi o que se fez em `Auth.module.css`, que
usa `featureIn` em vez de `fadeIn` por segurança).

## Organograma: hierarquia "impossível de editar"

**Sintoma real**: usuário não conseguia mudar a hierarquia do organograma.

**Causa dupla**: (1) os botões de ação de cada card (editar, excluir...) só
apareciam no `:hover`, difíceis de achar/alcançar; (2) vários cargos "raiz"
(sem `parent_id`) estavam dentro do mesmo `<ul>`, e uma regra CSS baseada em
`:only-child` acabava desenhando uma linha de conexão falsa entre raízes que
não tinham relação nenhuma entre si.

**Correção**: botões sempre visíveis, em fluxo normal dentro do card (não
dependente de hover); e — na reescrita seguinte do organograma — o sistema
de linhas trocou de CSS pseudo-elemento pra **SVG calculado a partir da
posição real dos elementos no DOM** (`getBoundingClientRect`), que não sofre
desse tipo de falso-positivo e de quebra ainda permite arrastar os cards
livremente (a linha só "segue" o elemento porque é recalculada, não porque
está presa via CSS).

## GLPI: nome de técnico não confiável pelo campo de busca

O `forcedisplay` do `/search/Ticket` desta instalação não devolve um nome
confiável pro campo "técnico" (veio número solto em teste real, não nome).
A solução foi resolver via `/Ticket_User` (vínculos, filtrados por
`type=2` = "atribuído a") + `/User` (nomes), cacheado à parte por ser caro
(ver `docs/INTEGRACOES.md` e `docs/DEPLOY.md`). Se um dia mexer nisso e
pensar "por que não usa o forcedisplay direto, é mais simples" — já foi
tentado, não funciona nesta instalação.

## Limite de subrequests / CPU do Worker Free

Coberto em detalhe em `docs/DEPLOY.md`. Resumo: **nunca** empilhar duas
sincronizações pesadas do GLPI (ou qualquer chamada de rede em loop) no
mesmo tick de cron / mesma requisição HTTP sem antes somar quantas
subrequests isso gera — o teto é 50 por invocação, não por dia.

## Checagens de permissão que aceitam "qualquer papel", não um papel específico

Vários endpoints mais antigos checam só `if (!role) return 403` (tem QUALQUER
acesso ao recurso → pode escrever), em vez de checar um papel específico
(`role === 'owner' || role === 'admin'`). Isso apareceu ao implementar o
perfil Auditor: o papel `'viewer'` que o Auditor recebe em
`lib/boardAccess.js` teoricamente passaria por essas checagens frouxas se
não fosse por outra camada. **A proteção real do Auditor não são essas
checagens locais — é o middleware global em `worker.js`**, que bloqueia
qualquer requisição de escrita desse papel antes mesmo de chegar na rota.
Não confiar cegamente numa checagem de `role` local pra decidir permissão de
escrita sem checar se ela testa um papel específico ou só "tem algum papel".

## `bcrypt` era rápido demais pra travar — mas caro demais pro Worker

Hash de senha trocou de `bcryptjs` pra PBKDF2 via Web Crypto
(`server/src/lib/password.js`) durante a migração pra Cloudflare: o
`bcrypt` originalmente usado excede o limite de ~10ms de CPU do plano Free
do Workers. Não havia usuários reais em produção na hora da troca, então não
houve hash antigo pra migrar — se algum dia precisar trocar de algoritmo de
novo com usuários reais, vai precisar de uma migração de verdade (hash
duplo, ou forçar reset de senha).

## `JWT_SECRET` precisa ser um secret fixo, não gerado a cada deploy

Se o `JWT_SECRET` mudar a cada deploy, todo mundo é deslogado (todo token
emitido antes vira inválido). Ele é um `wrangler secret`, definido uma vez —
nunca gerar ele dinamicamente no código nem versionar um valor fixo no
`wrangler.jsonc`.

## `confirm()`/`alert()` nativos do navegador foram banidos do projeto

Travam a thread principal, não têm estilo, e não dá pra `await` de verdade
de forma limpa. Todo lugar do app usa `confirmDialog`/`alertDialog`
(`client/src/store/dialogStore.js`) — um modal próprio do app, renderizado
uma vez por `<ConfirmDialogHost />` em `AppLayout.jsx`. Se aparecer um
`confirm(`/`alert(` novo em algum PR, é regressão, não estilo alternativo.

## Histórico de pivôs de produto (por que sobram tabelas/arquivos "mortos")

O projeto trocou de direção umas 4 vezes antes de chegar no modelo atual
(Kanban + tempo + chamados). Nessa troca de rota, código de fases anteriores
foi descartado sem sempre limpar 100% os rastros:
1. Migração de Render+Vercel+Turso pra Cloudflare Workers+D1 (arquitetura atual).
2. Tentativa de virar um clone do Pipefy (automações, formulários públicos,
   anexos via R2, múltiplos responsáveis) — chegou a ter rota e migração,
   mas o produto mudou de direção antes de ir pro ar.
3. Tentativa de virar um "administrador de demandas" (chamados internos +
   eventos + KPI mensal) — chegou a ter CÓDIGO pronto, mas a migração de
   banco NUNCA foi aplicada e nada foi ao ar; descartado.
4. Modelo atual: quadros Kanban estilo Trello + tempo, decisão final.

Os arquivos da fase 1 (`railway.toml`, `render.yaml`, `start.bat` e um
`index.html` solto na raiz) foram removidos em out/2026 — o serviço antigo
do Render ainda estava ligado ao repositório e tentava (e falhava) fazer
deploy a cada push no main; foi apagado no painel do Render. `uniflow.db` e
`uploads/`, se existirem numa máquina, são sobra local fora do git. E se um dia encontrar uma referência de código ou comentário
mencionando "Pipefy", "demandas", "chamados internos" com KPI mensal, ou
pastas vazias tipo `client/src/components/automation/` — é sobra dessas
fases, não uma feature ativa quebrada.
