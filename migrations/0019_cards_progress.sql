-- Status do cartão no estilo Planner (Não iniciado / Em andamento / Concluído),
-- independente da coluna em que ele está. `completed_at` fica preenchido só
-- enquanto progress = 'completed' (limpo se voltar atrás) — usado pelas
-- métricas de conclusão (quem concluiu, quando, quantas tarefas).
ALTER TABLE cards ADD COLUMN progress TEXT DEFAULT 'not_started';
ALTER TABLE cards ADD COLUMN completed_at TEXT;
