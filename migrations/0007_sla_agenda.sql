-- Fase 5 — SLA + Notificações por E-mail, e Agenda + Alertas Programados
-- Novas tabelas: configurações de app, regras de SLA (+ destinatários + dedup de
-- alertas), agenda de eventos (com recorrência), destinatários de resumo
-- semanal/diário, e a caixa de saída de e-mail (fila até um domínio de envio
-- ser configurado).

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE sla_rules (
  id TEXT PRIMARY KEY,
  board_id TEXT,                    -- NULL = todos os quadros
  name TEXT NOT NULL,
  threshold_hours INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sla_rule_recipients (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  user_id TEXT,                     -- um dos dois preenchido
  email TEXT,                       -- (usuário do sistema OU e-mail externo)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sla_alerts_sent (      -- dedup: não repete alerta pra mesma inatividade
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  activity_snapshot TEXT NOT NULL,
  alerted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(rule_id, card_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  board_id TEXT,                    -- NULL = evento global
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,         -- YYYY-MM-DD da primeira ocorrência
  event_time TEXT,                  -- HH:MM, opcional (nulo = dia todo)
  recurrence_type TEXT DEFAULT 'none',  -- none | weekly | monthly
  recurrence_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE digest_recipients (     -- quem recebe o resumo semanal/diário
  id TEXT PRIMARY KEY,
  digest_type TEXT NOT NULL,         -- weekly | daily
  user_id TEXT,
  email TEXT
);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT, to_user_id TEXT,
  subject TEXT NOT NULL, body_html TEXT NOT NULL, body_text TEXT NOT NULL,
  related_type TEXT, related_id TEXT,     -- 'sla' | 'weekly_digest' | 'daily_digest'
  status TEXT DEFAULT 'pending',          -- pending | sent | failed
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);
