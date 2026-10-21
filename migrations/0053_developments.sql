-- Gestão → Desenvolvimentos: vitrine dos sistemas/ferramentas que a equipe
-- desenvolveu (o próprio UniFlow, automações, sites...), com logo e para que
-- cada um serve. Ver server/src/routes/developments.js.
CREATE TABLE IF NOT EXISTS developments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,                 -- para que serve
  url TEXT,                     -- link do sistema (opcional)
  logo TEXT,                    -- imagem como data URL (png/webp/jpeg, já reduzida no navegador)
  status TEXT NOT NULL DEFAULT 'producao', -- producao | desenvolvimento | descontinuado
  order_index INTEGER NOT NULL DEFAULT 0,
  department_id TEXT,           -- NULL = Geral (todos veem)
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_developments_order ON developments(order_index, name);
