# Banco de dados

**Cloudflare D1** (SQLite gerenciado). O schema vive **versionado** em
`migrations/*.sql` — nunca é criado "na mão" nem recriado a cada boot do
Worker. As migrações são numeradas e cumulativas; a lista abaixo é o estado
**atual** (já aplicado em produção), não a lista de arquivos — várias tabelas
antigas (`pipes`, `cards` de outro shape, `demands`, `automations`, `forms`,
`pipe_*`, `user_routing_rules`...) foram criadas e depois **dropadas** em
migrações posteriores, sobras de pivôs de produto anteriores (veja
`docs/LICOES_APRENDIDAS.md`). Rodar
`npx wrangler d1 execute uniflow --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
sempre mostra a verdade atual, se este documento ficar desatualizado.

## Como migrar

```bash
npx wrangler d1 migrations apply uniflow --remote
```

Às vezes essa chamada falha com um erro transitório de autenticação
(`[code: 7403]`) sem motivo real — rodar de novo, sem mudar nada, costuma
resolver (confirmado várias vezes nesta sessão).

## Tabelas por domínio

### Usuários e organização
- **`users`** — `id, name, email, password (hash), avatar, google_id, system_role, department_id, created_at`. `system_role` é texto livre (`user` | `auditor` | `super_admin`), sem CHECK constraint.
- **`departments`** — nome/cor, usado pra agrupar usuários e pra visibilidade "de área" dos Super Admin (ver `ARQUITETURA.md`).
- **`notifications`** — notificações in-app por usuário (`type, title, content, link, read`).

### Quadros Kanban (o módulo principal)
- **`boards`**, **`board_members`** (papel `owner`/`admin`/`member`), **`board_labels`**, **`columns`**.
- **`cards`** — inclui `progress` (`not_started`/`in_progress`/`completed`, independente da coluna onde o card está — é o status "estilo Planner"), `due_date`, `priority`, `archived`.
- **`card_members`**, **`card_labels`**, **`card_checklist`**, **`card_comments`**, **`card_activities`** (feed de atividade do card).
- **`time_entries`** — cronômetro/lançamento manual de tempo por card e usuário (`started_at`, `ended_at`, `duration_seconds`).

### Chamados / GLPI (só cache local — a fonte da verdade é o GLPI)
- **`glpi_backlog_snapshot`** — snapshot pré-computado dos chamados em aberto (atualizado a cada 1 min pelo cron).
- **`glpi_total_snapshot`** / **`glpi_total_raw`** — histórico completo (aberto + finalizado); `_raw` guarda os tickets crus pra recalcular filtros por período sem bater no GLPI de novo.
- **`glpi_tech_cache`** — cache de "quem é o técnico de cada chamado" (caro de calcular — exige baixar toda a coleção `Ticket_User`/`User` do GLPI — por isso só roda a cada 15 min, isolado dos outros syncs).
- **`glpi_unparsed_tickets`** — chamados que bateram no filtro de "Eventos" (pra Agenda) mas não foram reconhecidos pelo parser; aparecem numa lista de revisão manual na aba GLPI do Admin.

### Base de Conhecimento
- **`kb_articles`** — `title, category, content, link_url, attachment_name/type/file_id (no Google Drive), created_by`.

### Aprovações
- **`approvals`**, **`approval_approvers`** — pedido + lista de aprovadores e decisão de cada um.

### Agenda / SLA / E-mail
- **`events`** — eventos da Agenda, com recorrência (`recurrence_type`: `none`/`weekly`/`monthly`), expandidos em ocorrências concretas em JS (`lib/schedule.js`, função `expandEventsInRange`), não em SQL.
- **`sla_rules`**, **`sla_rule_recipients`**, **`sla_alerts_sent`** — regras de "avisa se um card ficar X horas sem atividade" (dedup por `sla_alerts_sent`, pra não repetir o mesmo alerta).
- **`digest_recipients`**, **`app_settings`** — destinatários e configuração (horário/dia) dos resumos diário/semanal por e-mail.
- **`email_outbox`** — fila de e-mail: todo e-mail do sistema passa por aqui antes de ser enviado de verdade (`lib/email.js`, `flushOutbox`) — ver `docs/INTEGRACOES.md`.

### Cadastros (Empresas, Link de Internet, Impressoras)
- **`company_branches`** — filiais/empresas, com endereço (preenchido por CEP) e mapa.
- **`internet_links`** — link de internet por local (`sede`/`campus-conceito`/`administrativo`/`clinicas`), com `order_index` pra reordenação manual (drag-and-drop).
- **`printers`** — impressoras por local, com driver anexado (Google Drive).

### TIME (Organograma + Desempenho)
- **`org_chart_nodes`** — cargo/pessoa, com `parent_id` (hierarquia), `offset_x/offset_y` (posição livre arrastada no canvas).
- **`org_chart_links`** — conexões "soltas" entre dois cargos sem relação de hierarquia direta.
- **`org_chart_free_lines`** — linhas livres desenhadas no canvas, estilo Canva, coordenadas fixas `x1,y1,x2,y2`.
- **`team_kudos_members`** — roster de quem aparece na aba Desempenho.
- **`team_kudos_events`** — cada 👍/👎 dado (`type`: `star`=like / `moon`=dislike — nomes internos antigos, a UI já mudou pra polegar-pra-cima/baixo mas o schema ficou com os nomes originais), com `comment` opcional e `given_by`.

## Padrões usados em (quase) toda tabela

- `id` é sempre um UUID v4 (gerado em JS, nunca autoincrement).
- `created_at`/`updated_at` são `TEXT` no formato `datetime('now')` do SQLite —
  **UTC, sem sufixo `Z`**. O front-end nunca deve fazer só `new Date(str)`
  nesses campos (o navegador assume horário local e erra o fuso); sempre usar
  `parseDbTimestamp` (`client/src/utils/formatDuration.js`), que resolve isso
  corretamente. Esse foi um bug real revisitado várias vezes nesta sessão.
