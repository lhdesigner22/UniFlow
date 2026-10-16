-- Resolução retroativa de chamados do GLPI (Admin → GLPI): depois que o
-- evento já passou, o chamado é marcado como Solucionado no GLPI. Guarda o
-- resultado por evento pra não tentar de novo o mesmo chamado:
--   'solved'  → solucionado por aqui
--   'skipped' → o status do chamado no GLPI já tinha mudado (alguém tratou à
--               mão), então não mexemos
ALTER TABLE events ADD COLUMN glpi_resolve_state TEXT;
ALTER TABLE events ADD COLUMN glpi_resolved_at TEXT;
