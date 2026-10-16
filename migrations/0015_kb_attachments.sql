-- Anexo de verdade pros artigos da Base de Conhecimento — guardado como
-- base64 numa coluna TEXT (R2 está desativado nessa conta, exige habilitar
-- billing; D1 já está disponível e dá conta de arquivos pequenos/médios).
-- Limite de tamanho (D1: valor de coluna/linha até 2 MB) é aplicado na rota
-- (server/src/routes/kb.js) antes de gravar.
ALTER TABLE kb_articles ADD COLUMN attachment_name TEXT;
ALTER TABLE kb_articles ADD COLUMN attachment_type TEXT;
ALTER TABLE kb_articles ADD COLUMN attachment_data TEXT; -- base64, sem o prefixo "data:...;base64,"
