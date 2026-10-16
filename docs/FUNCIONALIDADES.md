# Funcionalidades

Um resumo de cada módulo/tela: o que faz, pra quem, e onde fica o código.
Front-end sempre em `client/src/pages/`, back-end sempre em `server/src/routes/`
— só cito quando o nome do arquivo não é óbvio a partir do nome da tela.

## Início (Dashboard)
`DashboardPage.jsx` · rota `boards.js`, `timeEntries.js`

Primeira tela ao entrar: grid dos quadros do usuário (com atalho "+ Novo
quadro"), lista "Meus cards" (onde é responsável, ordenado por prazo), feed
de atividade da equipe, e um aviso fixo no topo se o usuário tiver um
cronômetro rodando em algum card (pra não esquecer aberto).

## Quadros Kanban
`BoardPage.jsx`, `components/board/*` · `boards.js`, `columns.js`, `cards.js`

Estilo Trello: quadro → colunas → cards, drag-and-drop via `@dnd-kit`. Cada
quadro nasce com 3 colunas padrão (A Fazer / Em Andamento / Concluído). Card
tem, além de título/descrição: checklist, membros, etiquetas coloridas,
prazo, comentários, atividade, e **cronômetro de tempo** (inicia/pausa,
persiste em `time_entries`; ao trocar de card com o cronômetro rodando, ele
continua no card antigo — só um de cada vez por usuário, ver `timeEntries.js`).
`progress` (não iniciado/em andamento/concluído) é independente da coluna —
alguém pode marcar um card "concluído" sem mover ele fisicamente de coluna.

## Tempo da equipe
`TeamTimePage.jsx` · `timeEntries.js`

Relatório agregado de tempo lançado, filtrável por quadro/período, com
gráfico (`recharts`) e exportação em CSV.

## Chamados (integração com GLPI)
`BacklogPage.jsx`, `TotalChamadosPage.jsx` · `glpiBacklog.js`, `glpiTotal.js`, `glpi.js`

**Só leitura** — não cria/edita chamado no GLPI, só importa e mostra.
- **Backlog de Chamados**: só os chamados em aberto agora, atualizado pelo
  cron a cada 1 min. KPIs por status/técnico/idade, tabela filtrável.
- **Total de Chamados**: histórico completo (aberto + finalizado), taxa de
  resolução, tempo médio, atualizado a cada 15 min (é uma varredura pesada —
  a instalação tem mais de 10 mil chamados).
- Botão **"🔄 Atualizar agora"** (Super Admin), presente nas duas telas,
  dispara os dois sincronismos **junto** com o de Eventos da Agenda — ver
  `client/src/utils/glpiRefresh.js` e `docs/INTEGRACOES.md` pro motivo de eles
  serem 3 chamadas HTTP separadas em vez de uma só.
- A aba **GLPI** dentro do Admin (`AdminPage.jsx`) configura o filtro de
  status/entidade usado pra importar chamados como **Eventos da Agenda**, e
  lista os chamados que bateram no filtro mas não foram reconhecidos pelo
  parser (`glpi_unparsed_tickets`), pra revisão manual.

## Aprovações
`ApprovalsPage.jsx` · `approvals.js`

Pedido formal de "sim"/"não" com um ou mais aprovadores e anexo opcional
(Google Drive). Duas abas: "Recebidas" (onde a pessoa é aprovadora) e
"Enviadas" (o que ela pediu). Qualquer usuário logado pode pedir e aprovar —
não é restrito a Super Admin.

## Base de Conhecimento
`KnowledgeBasePage.jsx` · `kb.js`

Artigos com categoria (texto pronto / política / documento / outro), busca
por título/conteúdo, anexo de até 95 MB (Google Drive). Qualquer usuário cria;
só o autor, Super Admin ou Auditor edita/exclui um artigo de outra pessoa.

## Agenda
`AgendaPage.jsx` · `events.js`

Lista de eventos (não é uma grade de calendário), com recorrência opcional
(semanal/mensal). Também recebe automaticamente chamados da fila configurada
no GLPI (ver acima). Qualquer usuário logado gerencia.

## Empresas / Link de Internet / Impressoras
`CompaniesPage.jsx`, `InternetLinksPage.jsx`, `PrintersPage.jsx` ·
`companies.js`, `internetLinks.js`, `printers.js`

Cadastros com leitura liberada a qualquer usuário logado, escrita restrita a
Super Admin (autor original também pode editar/excluir o que criou).
- **Empresas**: endereço com autofill por CEP (API pública ViaCEP) + mapa do
  Google embutido (iframe `output=embed`, **sem chave de API** — decisão
  deliberada pra não precisar de faturamento no Google Cloud).
- **Link de Internet**: operadora/velocidade/contato por local, com
  reordenação por arrastar-e-soltar (persiste em `order_index`).
- **Impressoras**: modelo/IP/driver por local.

## TIME → Organograma
`OrgChartPage.jsx` · `orgChart.js`

Hierarquia da equipe (cargos com `parent_id`), renderizada em fileiras
horizontais por nível (não árvore ramificada — decisão pra bater com uma
referência visual pedida no meio da sessão). Três interações de edição
(Super Admin):
1. Arrastar um cargo livremente pelo canvas (`offset_x/offset_y`) — as linhas
   de hierarquia acompanham porque são recalculadas medindo a posição real
   dos elementos no DOM (`getBoundingClientRect`), não CSS estático.
2. "🔗 Ligar" dois cargos sem hierarquia direta entre eles.
3. "✏️ Desenhar linha" — linha livre estilo Canva, em qualquer lugar do canvas.

## TIME → Desempenho
`TeamPerformancePage.jsx` · `teamKudos.js`

Cada colaborador cadastrado (roster próprio, não são todos os usuários do
sistema — precisa ser adicionado) recebe 👍 ou 👎 de reconhecimento.
- **Dar 👍/👎, com motivo opcional, e remover um lançamento**: só Super Admin
  (dá pelo modal "Dar 👍/👎", que abre um campo de motivo antes de confirmar).
- **Ver o histórico** (quem deu, quando, motivo): qualquer usuário — mas um
  usuário comum só vê os 👍 no histórico; os 👎 aparecem só pro Super Admin
  (filtrado no próprio backend, `GET /members/:id/events`, não só escondido
  na tela).

## Métricas
`MetricsPage.jsx` · `metrics.js`

KPIs "estilo Planner" escopados aos quadros que o usuário enxerga
(`lib/boardAccess.js`): total criado, concluídas, taxa de conclusão,
concluídas por pessoa, tarefas por quadro, conclusões ao longo do tempo, e
cards atrasados por quadro (esse último **não** é filtrado pelo período
escolhido nos outros gráficos — é sempre o estado atual, faz mais sentido pra
"o que está atrasado agora").

## Administração
`AdminPage.jsx` · `admin.js`, `slaRules.js`, `appSettings.js`, `glpi.js`

Só Super Admin edita; Auditor vê em modo leitura (ver `ARQUITETURA.md`).
Abas: Usuários (papel + departamento de cada um), Departamentos, SLA (regras
de alerta de inatividade), Notificações (resumos diário/semanal por e-mail +
fila de e-mail pendente), GLPI (config do filtro de Eventos + chamados não
reconhecidos).

## PWA
`client/vite.config.js` (plugin `vite-plugin-pwa`), `client/public/*`

O site é instalável como app (computador e celular). Service worker
(`registerType: 'autoUpdate'`) cacheia só os arquivos estáticos do build —
nunca `/api/*`, que sempre vai à rede. Ícones gerados a partir de
`client/scripts/icon-sources/*.svg` (rodar `client/scripts/gen-icons.mjs` de
novo só se o logo mudar — precisa `npm i -D sharp` primeiro, não é dependência
do projeto).
