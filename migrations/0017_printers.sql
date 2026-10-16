-- Cadastro de impressoras por local (SEDE/ADM/CENTRO) — modelo, IP
-- configurado, e o driver de instalação (anexo no Google Drive, mesma
-- infra da Base de Conhecimento) ou um link direto de instalação.
CREATE TABLE printers (
  id TEXT PRIMARY KEY,
  location TEXT NOT NULL, -- sede | adm | centro
  model TEXT NOT NULL,
  ip TEXT,
  link_url TEXT,           -- link direto de instalação (opcional)
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_file_id TEXT, -- ID do arquivo no Google Drive (driver)
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
