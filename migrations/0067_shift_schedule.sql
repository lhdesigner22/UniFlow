-- Time → Escala: quem trabalha onde em cada dia do mês.
-- Pessoas são uma lista própria (nem todo mundo da escala tem login no UniFlow);
-- user_id liga a pessoa a um usuário quando existir. Usa o módulo `team`
-- (sem módulo novo): quem tem Time "editar" monta, "ver" consulta.

CREATE TABLE shift_people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT,             -- função (ex.: Auxiliar de T.I.)
  hours TEXT,                  -- horário em texto (ex.: Seg a Sex 13h 22h e Sab 13h 17h)
  user_id TEXT,
  department_id TEXT,          -- NULL = Geral
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_shift_people_dept_order ON shift_people(department_id, order_index);

-- Um registro por pessoa e dia. Sem registro = dia não definido.
-- status: SEDE | CENTRO | G5 | FOLGA | FERIAS
CREATE TABLE shift_assignments (
  person_id TEXT NOT NULL,
  day TEXT NOT NULL,           -- YYYY-MM-DD
  status TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, day)
);
CREATE INDEX idx_shift_assignments_day ON shift_assignments(day);
