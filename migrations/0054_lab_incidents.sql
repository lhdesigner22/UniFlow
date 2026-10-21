-- Fluxos → Incidentes Laboratórios: registro de máquinas com defeito,
-- sinistros/danos, problemas de projeção/TV, bagunça etc. nos laboratórios de
-- informática, com fotos. Ver server/src/routes/labIncidents.js.

CREATE TABLE IF NOT EXISTS lab_incidents (
  id TEXT PRIMARY KEY,
  building TEXT NOT NULL,              -- sede | centro | g5
  lab TEXT NOT NULL,                   -- laboratório / sala
  category TEXT NOT NULL,              -- maquina | sinistro | projecao | organizacao | rede | outro
  severity TEXT NOT NULL DEFAULT 'media', -- baixa | media | alta | critica
  title TEXT NOT NULL,                 -- resumo curto
  description TEXT,
  equipment TEXT,                      -- ex: "PC 12 da bancada 3", "Projetor Epson"
  patrimony TEXT,
  occurred_at TEXT NOT NULL,           -- data e hora da ocorrência, horário de Brasília ('YYYY-MM-DDTHH:MM')
  reported_by_name TEXT,               -- quem relatou (professor, aluno, monitor...)
  class_info TEXT,                     -- turma / aula / professor no horário
  glpi_ticket TEXT,                    -- nº do chamado no GLPI, se abriu
  status TEXT NOT NULL DEFAULT 'aberto', -- aberto | em_andamento | resolvido
  resolution TEXT,                     -- o que foi feito
  resolved_at TEXT,
  resolved_by TEXT,
  department_id TEXT,                  -- NULL = Geral
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_incidents_building ON lab_incidents(building, status, occurred_at);

-- Fotos reduzidas no navegador (data URL): `thumb` pra lista, `data` pra ver grande.
CREATE TABLE IF NOT EXISTS lab_incident_photos (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  thumb TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_incident_photos ON lab_incident_photos(incident_id, created_at);

-- Módulo novo "incidents" nos cargos que já existem: quem opera (Super Admin,
-- Gestor, Analista) registra; Colaborador e Auditor só consultam. Cargos
-- criados à mão ficam sem acesso até alguém liberar em Admin → Cargos.
UPDATE roles SET permissions = json_set(permissions, '$.incidents', 'edit') WHERE id IN ('role-super-admin', 'role-gestor', 'role-analista');
UPDATE roles SET permissions = json_set(permissions, '$.incidents', 'view') WHERE id IN ('role-colaborador', 'role-auditor');
