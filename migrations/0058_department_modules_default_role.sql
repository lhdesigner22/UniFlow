-- O que cada departamento enxerga + cargo padrão de quem entra pela 1ª vez.
--
-- departments.module_limits: JSON { módulo: 'none' | 'view' | 'edit' } — TETO
-- por módulo para quem é do departamento (o acesso final é o menor entre o
-- cargo e o departamento; o departamento nunca dá mais que o cargo). NULL ou
-- módulo ausente = sem limite ("conforme o cargo"). Super Admin e Auditor não
-- são afetados. Ver loadAccess em server/src/lib/permissions.js.
ALTER TABLE departments ADD COLUMN module_limits TEXT;

-- Cargo que quem entra pela primeira vez recebe (Admin → Cargos). Antes era
-- fixo: Colaborador.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_role_id', 'role-colaborador');
