-- Chamados do GLPI que são REPETIÇÃO de um evento que já está na Agenda (mesmo
-- título, data, hora e local). A sincronização não cria evento pra eles — fica
-- só o registro aqui, pra Agenda não mostrar o mesmo evento duas vezes — e eles
-- aguardam ser solucionados no GLPI (Admin → GLPI → Chamados duplicados).
CREATE TABLE IF NOT EXISTS glpi_duplicate_tickets (
  glpi_ticket_id INTEGER PRIMARY KEY,
  duplicate_of INTEGER NOT NULL,   -- chamado cujo evento está na Agenda
  title TEXT,
  event_date TEXT,
  event_time TEXT,
  resolve_state TEXT,              -- NULL = ainda não solucionado no GLPI; 'solved' | 'skipped' | 'not_found'
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
