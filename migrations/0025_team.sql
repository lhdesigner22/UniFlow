-- Nova aba "Time": Organograma + Desempenho.

-- Organograma — estrutura livre (não amarrada a usuários), pra incluir
-- também vagas genéricas sem nome específico (ex: "Estágio" vazio na
-- referência do usuário). parent_id nulo = topo da hierarquia.
CREATE TABLE org_chart_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  order_index INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Desempenho — roster de colaboradores (usuários reais do sistema, foto e
-- nome vêm de `users`) que recebem reconhecimento da equipe.
CREATE TABLE team_kudos_members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cada estrela (positivo) ou lua (negativo) dada por alguém a um membro do
-- roster acima — histórico completo, o total é somado na leitura.
CREATE TABLE team_kudos_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'star' | 'moon'
  comment TEXT,
  given_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
