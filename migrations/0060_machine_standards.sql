-- Base de Conhecimento → Padronização de máquinas: a configuração mínima de
-- computador por cargo e as exceções por setor. Institucional: sem separação
-- por departamento. Ver server/src/routes/machineStandards.js.
CREATE TABLE IF NOT EXISTS machine_standards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'cargo',  -- cargo | setor (setor = exceção, vale para qualquer cargo dele)
  name TEXT NOT NULL,                  -- ex: "Estagiário", "Marketing audiovisual"
  audience TEXT,                       -- quem entra nesse perfil / observação
  cpu TEXT,                            -- ex: "Intel Core i5"
  ram TEXT,                            -- ex: "8 a 16 GB"
  extra TEXT,                          -- ex: "Placa de vídeo dedicada"
  icon TEXT,                           -- emoji
  color TEXT,                          -- cor do ícone (#RRGGBB)
  order_index INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_machine_standards_order ON machine_standards(kind, order_index);

-- Conteúdo da apresentação "Padronização de máquinas" (out/2026)
INSERT OR IGNORE INTO machine_standards (id, kind, name, audience, cpu, ram, extra, icon, color, order_index) VALUES
('ms-estagiario', 'cargo', 'Estagiário', NULL, 'Intel Core i3', '8 GB', NULL, '🎓', '#7ED957', 0),
('ms-auxiliar', 'cargo', 'Auxiliar e assistente', NULL, 'Intel Core i5', '8 a 16 GB', NULL, '👥', '#F5C518', 1),
('ms-analista', 'cargo', 'Analista, especialista e liderança', 'Inclui coordenação, gerência e diretoria', 'Intel Core i7 ou superior', '16 GB', NULL, '👔', '#2D4FC4', 2),
('ms-solucoes-digitais', 'setor', 'Soluções Digitais', 'Todo o setor, qualquer cargo', 'Intel Core i7 ou superior', 'No mínimo 16 GB', NULL, '💻', '#00B0D4', 3),
('ms-marketing-audiovisual', 'setor', 'Marketing audiovisual', 'Exceção para quem edita vídeo', 'Intel Core i7 ou superior', 'No mínimo 16 GB', 'Placa de vídeo dedicada', '🎬', '#FF2D5E', 4);
