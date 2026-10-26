-- A lista de cartões do quadro passou a trazer as etiquetas de cada cartão
-- (GET /boards/:id/cards): busca board_labels pelo quadro e card_labels pela
-- etiqueta. Sem estes índices as duas tabelas seriam lidas inteiras.
CREATE INDEX IF NOT EXISTS idx_board_labels_board ON board_labels(board_id);
CREATE INDEX IF NOT EXISTS idx_card_labels_label ON card_labels(label_id);
