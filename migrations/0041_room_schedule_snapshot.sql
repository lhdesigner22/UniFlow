-- Cópia sincronizada periodicamente da grade de salas do
-- unifecaf-horario.netlify.app (visualização pública, sem login) — usada
-- pra "puxar o professor" quando alguém digita a sala em Empréstimo de
-- Equipamentos. Não é a fonte oficial: é só um espelho, atualizado por um
-- job programado (não em tempo real). Cada sync apaga e regrava os dias
-- daquele prédio (full refresh, mais simples que tentar dar merge).
CREATE TABLE room_schedule_snapshot (
  id TEXT PRIMARY KEY,
  building TEXT NOT NULL,       -- sede | centro | g5
  room_name TEXT NOT NULL,      -- nome da sala como aparece no site de origem
  day_date TEXT NOT NULL,       -- YYYY-MM-DD
  occupation_type TEXT,         -- aula_oficial | pre_aula | pos_aula | semipresencial | disponivel | sem_uso
  class_code TEXT,
  professor_name TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_room_schedule_lookup ON room_schedule_snapshot(building, room_name, day_date);
