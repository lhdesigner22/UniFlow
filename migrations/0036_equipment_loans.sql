-- Empréstimo de Equipamentos — substitui a "Planilha de reservas" (Chromebook,
-- controle de projetor, caixa de som, adaptador etc. emprestados e
-- devolvidos). Mesma ideia da planilha (quem pegou, o quê, patrimônio,
-- sala/local, situação), sem os dados históricos dela — começa vazia.
CREATE TABLE equipment_loans (
  id TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  requester_email TEXT,
  equipment_model TEXT NOT NULL,
  patrimony TEXT,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_devolucao', -- aguardando_devolucao | devolvido | uso_permanente
  loan_date TEXT NOT NULL DEFAULT (date('now')),
  returned_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_equipment_loans_status ON equipment_loans(status);
CREATE INDEX idx_equipment_loans_loan_date ON equipment_loans(loan_date);
CREATE INDEX idx_equipment_loans_created_by ON equipment_loans(created_by);
