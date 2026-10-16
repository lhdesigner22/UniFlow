-- Ordem manual das impressoras (arrastar-e-soltar, por local). Começa
-- igual à ordem de hoje (modelo, A-Z; desempate pelo id) pra nada mudar de
-- lugar até alguém reorganizar.
ALTER TABLE printers ADD COLUMN order_index INTEGER DEFAULT 0;

UPDATE printers SET order_index = (
  SELECT COUNT(*) FROM printers p2
  WHERE p2.location = printers.location
    AND (p2.model < printers.model OR (p2.model = printers.model AND p2.id < printers.id))
);
