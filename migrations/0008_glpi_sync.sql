-- Importação automática de chamados do GLPI (fila "Eventos") pra Agenda.
-- `glpi_ticket_id` em `events` evita importar o mesmo chamado duas vezes
-- (dedup via UNIQUE, checado no INSERT antes de criar o evento).
ALTER TABLE events ADD COLUMN glpi_ticket_id INTEGER;
CREATE UNIQUE INDEX idx_events_glpi_ticket_id ON events(glpi_ticket_id) WHERE glpi_ticket_id IS NOT NULL;

-- Chamados que bateram no filtro (status/entidade) mas cuja descrição não
-- seguiu o formato esperado — ficam aqui pra revisão manual em vez de criar
-- um evento com data errada ou silenciosamente desaparecer.
CREATE TABLE glpi_unparsed_tickets (
  id TEXT PRIMARY KEY,
  glpi_ticket_id INTEGER NOT NULL UNIQUE,
  title TEXT,
  raw_description TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  dismissed INTEGER DEFAULT 0
);
