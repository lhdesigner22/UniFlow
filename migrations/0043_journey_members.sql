-- Lista própria da Jornada (independente do quadro de Desempenho): o Super
-- Admin escolhe quem aparece. Começa com as mesmas pessoas do Desempenho e
-- daí em diante cada lista é ajustada separadamente.
CREATE TABLE journey_members (
  user_id TEXT PRIMARY KEY,
  added_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO journey_members (user_id, added_by)
SELECT user_id, added_by FROM team_kudos_members;
