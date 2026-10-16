-- Base de Conhecimento: textos prontos de chamado, políticas (com link pra
-- documento externo, já que R2 está desativado nessa conta) e outros
-- materiais de referência, compartilhados entre todos os usuários.
CREATE TABLE kb_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'texto_pronto', -- texto_pronto | politica | documento | outro
  content TEXT,        -- corpo do artigo (texto simples, com quebras de linha)
  link_url TEXT,       -- link externo opcional (ex: Google Drive/Docs) pro documento
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
