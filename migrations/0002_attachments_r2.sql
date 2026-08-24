-- Adiciona a chave do objeto no R2 para anexos (substitui armazenamento local)
ALTER TABLE card_attachments ADD COLUMN r2_key TEXT;
