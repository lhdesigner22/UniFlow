-- Portal do Professor (nov/2026): o professor entra no UniFlow e só vê uma tela
-- própria para pedir Chromebooks (a TI confirma em Empréstimos → Pedidos de
-- Chromebook) e abrir chamados no GLPI. Rotas: routes/teacher.js (módulo
-- `teacher`) e routes/chromebookRequests.js (módulo `loans`).

-- Pedidos de Chromebook. Sem separação por departamento: é atendimento da TI.
-- status: pendente → aprovada | recusada (pela TI) | cancelada (pelo professor)
CREATE TABLE IF NOT EXISTS chromebook_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  building TEXT NOT NULL,              -- SEDE | CENTRO | G5
  room TEXT NOT NULL,
  use_date TEXT NOT NULL,              -- YYYY-MM-DD (horário de Brasília)
  start_time TEXT NOT NULL,            -- HH:MM
  end_time TEXT NOT NULL,              -- HH:MM
  quantity INTEGER NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chromebook_requests_user ON chromebook_requests(user_id, use_date);
CREATE INDEX IF NOT EXISTS idx_chromebook_requests_date ON chromebook_requests(use_date, status);

-- Chamados abertos pelo portal. A situação vem do GLPI e fica guardada aqui
-- (glpi_status + status_checked_at) para não perguntar ao GLPI a cada visita.
CREATE TABLE IF NOT EXISTS teacher_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  glpi_ticket_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- computador | projetor | internet | acesso | outro
  building TEXT,
  room TEXT,
  title TEXT NOT NULL,
  glpi_status INTEGER NOT NULL DEFAULT 1,
  status_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_teacher_tickets_user ON teacher_tickets(user_id, created_at);

-- Módulo novo `teacher`: nenhum cargo existente usa o portal (a equipe da TI
-- trabalha pelo app normal); o Super Admin vale sempre "edit" pelo código.
UPDATE roles SET permissions = json_set(permissions, '$.teacher', 'none') WHERE id != 'role-super-admin';
UPDATE roles SET permissions = json_set(permissions, '$.teacher', 'edit') WHERE id = 'role-super-admin';

-- Cargo Professor: só o portal.
INSERT OR IGNORE INTO roles (id, name, description, system_role, scope, permissions, is_locked, order_index) VALUES
 ('role-professor', 'Professor', 'Só o Portal do Professor: pedir Chromebooks e abrir chamados. Dado no 1º login de quem entra com o domínio dos professores.', 'user', 'department',
  '{"boards":"none","agenda":"none","metrics":"none","team":"none","tickets":"none","kb":"none","gestao":"none","approvals":"none","purchases":"none","printers":"none","loans":"none","companies":"none","incidents":"none","teacher":"edit"}',
  0, 60);

-- Quem entra pela 1ª vez com este domínio recebe o cargo Professor (routes/auth.js).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('teacher_email_domain', 'pro.fecaf.com.br');
-- Entidade do GLPI onde caem os chamados do portal (4 = SERVICE DESK).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('teacher_glpi_entity_id', '4');
