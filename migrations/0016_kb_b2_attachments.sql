-- Anexos da Base de Conhecimento passam a ficar no Backblaze B2 (storage
-- externo) em vez de base64 no D1 — permite arquivos bem maiores (até 50 MB)
-- sem esbarrar no limite de 2 MB por valor de coluna do D1.
-- `attachment_file_id`/`attachment_file_key` identificam o arquivo no B2
-- (pra baixar/apagar); `attachment_name`/`attachment_type` (já existentes)
-- continuam guardando o nome de exibição e o mime type.
-- A coluna antiga `attachment_data` (base64) fica sem uso, sem problema.
ALTER TABLE kb_articles ADD COLUMN attachment_file_id TEXT;
ALTER TABLE kb_articles ADD COLUMN attachment_file_key TEXT;
