-- Prédio da empresa onde o equipamento foi emprestado (SEDE/CENTRO/G5) —
-- mesma ideia do "location" de printers.js, mas com sub-conjunto de prédios
-- (Empréstimo de Equipamentos não cobre ADM nem CLÍNICAS). Continua existindo
-- separado do campo livre "location" (Sala/Localidade) da tabela, que é o
-- detalhe dentro do prédio (ex: "Sala 510").
ALTER TABLE equipment_loans ADD COLUMN building TEXT NOT NULL DEFAULT 'sede';

CREATE INDEX idx_equipment_loans_building ON equipment_loans(building);
