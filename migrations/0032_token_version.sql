-- Permite "forçar novo login" de um usuário específico (ex: pra sincronizar
-- a foto do Google na hora, em vez de esperar a sessão de 7 dias expirar
-- sozinha) — incrementar isso invalida o token JWT que a pessoa já tem
-- salvo, sem mexer em senha/conta Google dela.
ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0;
