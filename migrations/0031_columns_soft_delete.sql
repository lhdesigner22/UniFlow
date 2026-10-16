-- Excluir coluna virou "mandar pra lixeira" (soft delete) em vez de apagar
-- na hora — dá pra restaurar depois. Os cartões da coluna continuam no
-- banco intactos (não fazem mais parte do cascade de exclusão), só ficam
-- invisíveis enquanto a coluna estiver na lixeira.
ALTER TABLE columns ADD COLUMN deleted_at TEXT;
