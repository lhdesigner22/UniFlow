-- Pivot: fim do modelo Pipefy (pipes/kanban/automações/aprovações), início do
-- modelo "Administrador de Demandas Mensais" (chamados + eventos + KPIs).
-- Não há dados reais em produção (só contas de teste) — apaga todo o domínio
-- pipe sem risco de perda real. Mantém intactas: users, departments, notifications.

DROP TABLE IF EXISTS pipes;
DROP TABLE IF EXISTS pipe_members;
DROP TABLE IF EXISTS phases;
DROP TABLE IF EXISTS pipe_fields;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS card_fields;
DROP TABLE IF EXISTS card_comments;
DROP TABLE IF EXISTS card_attachments;
DROP TABLE IF EXISTS card_checklist;
DROP TABLE IF EXISTS card_activities;
DROP TABLE IF EXISTS pipe_labels;
DROP TABLE IF EXISTS automations;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS user_routing_rules;
DROP TABLE IF EXISTS pipe_routing_rules;
DROP TABLE IF EXISTS pipe_routing_groups;
DROP TABLE IF EXISTS pipe_custom_groups;
DROP TABLE IF EXISTS pipe_custom_group_members;
DROP TABLE IF EXISTS card_assignees;
DROP TABLE IF EXISTS card_followers;

CREATE TABLE demands (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- 'chamado' | 'evento'
  title TEXT NOT NULL,
  description TEXT,
  department_id TEXT,                    -- setor destino (chamado) / responsável (evento)
  status TEXT DEFAULT 'aberto',          -- aberto | em_andamento | concluido | cancelado
  priority TEXT,                          -- baixa | media | alta (sobretudo chamados)
  created_by TEXT NOT NULL,
  assigned_to TEXT,
  due_date TEXT,                          -- prazo (chamado)
  event_date TEXT,                        -- data/hora do evento
  location TEXT,                          -- local do evento
  due_alerted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE demand_comments (
  id TEXT PRIMARY KEY,
  demand_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE demand_activities (
  id TEXT PRIMARY KEY,
  demand_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
