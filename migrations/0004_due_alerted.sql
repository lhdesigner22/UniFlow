-- Marca se um card já disparou o alerta de "data limite se aproximando" (evita repetir a cada hora)
ALTER TABLE cards ADD COLUMN due_alerted INTEGER DEFAULT 0;
