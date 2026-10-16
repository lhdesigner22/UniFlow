-- Arquivar quadro (sem apagar) — some da lista principal (sidebar/Início)
-- sem perder colunas/cards/histórico, com opção de restaurar depois.
ALTER TABLE boards ADD COLUMN archived INTEGER DEFAULT 0;
