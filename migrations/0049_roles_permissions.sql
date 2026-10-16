-- Cargos configuráveis (como os "perfis" do GLPI): cada cargo define, por
-- módulo, se a pessoa NÃO VÊ ('none'), só VÊ ('view') ou pode EDITAR ('edit'),
-- e se enxerga o conteúdo de TODOS os departamentos ('all') ou só do seu
-- ('department').
--
-- `system_role` = equivalência com o perfil técnico que o código antigo checa
-- (super_admin / auditor / user). Cargos criados no Admin são sempre 'user';
-- só os nativos Super Admin e Auditor têm os outros dois. Assim nada do que já
-- existe (51 checagens de super_admin) precisa mudar.
--
-- `permissions` = JSON { módulo: 'none' | 'view' | 'edit' }. Módulos: ver
-- server/src/lib/permissions.js. Módulo ausente = 'none'.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  system_role TEXT NOT NULL DEFAULT 'user',
  scope TEXT NOT NULL DEFAULT 'department',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_locked INTEGER NOT NULL DEFAULT 0,   -- nativos que não se apagam nem mudam de permissão (Super Admin, Auditor)
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE users ADD COLUMN role_id TEXT;

INSERT INTO roles (id, name, description, system_role, scope, permissions, is_locked, order_index) VALUES
 ('role-super-admin', 'Super Admin', 'Acesso total ao sistema e à administração. Enxerga todos os departamentos.', 'super_admin', 'all',
  '{"boards":"edit","agenda":"edit","metrics":"edit","team":"edit","tickets":"edit","kb":"edit","gestao":"edit","approvals":"edit","purchases":"edit","printers":"edit","loans":"edit","companies":"edit"}', 1, 0),
 ('role-gestor', 'Gestor', 'Gerencia o conteúdo do seu departamento.', 'user', 'department',
  '{"boards":"edit","agenda":"edit","metrics":"edit","team":"edit","tickets":"edit","kb":"edit","gestao":"edit","approvals":"edit","purchases":"edit","printers":"edit","loans":"edit","companies":"edit"}', 0, 1),
 ('role-analista', 'Analista', 'Opera o dia a dia do seu departamento (mesmo acesso que todo mundo já tinha até aqui).', 'user', 'department',
  '{"boards":"edit","agenda":"edit","metrics":"edit","team":"edit","tickets":"edit","kb":"edit","gestao":"edit","approvals":"edit","purchases":"edit","printers":"edit","loans":"edit","companies":"edit"}', 0, 2),
 ('role-colaborador', 'Colaborador', 'Acesso básico: consulta e participa do que é do seu departamento. Cargo padrão de quem entra agora.', 'user', 'department',
  '{"boards":"edit","agenda":"view","metrics":"none","team":"view","tickets":"none","kb":"view","gestao":"none","approvals":"edit","purchases":"edit","printers":"view","loans":"view","companies":"view"}', 0, 3),
 ('role-auditor', 'Auditor', 'Só leitura em todo o sistema, em todos os departamentos (única escrita permitida: Base de Conhecimento).', 'auditor', 'all',
  '{"boards":"view","agenda":"view","metrics":"view","team":"view","tickets":"view","kb":"edit","gestao":"view","approvals":"view","purchases":"view","printers":"view","loans":"view","companies":"view"}', 1, 4);

-- Quem já existe mantém exatamente o acesso de hoje: Super Admin continua Super
-- Admin, Auditor continua Auditor, e os demais viram Analista (que equivale ao
-- acesso que "usuário" já tinha). Quem entrar depois sem cargo cai em Colaborador.
UPDATE users SET role_id = CASE COALESCE(system_role, 'user')
  WHEN 'super_admin' THEN 'role-super-admin'
  WHEN 'auditor' THEN 'role-auditor'
  ELSE 'role-analista'
END;
