-- Liga o empréstimo a um item do inventário (opcional — ainda dá pra
-- registrar um patrimônio avulso digitado à mão, fora do inventário). É
-- assim que a tela sabe quais itens do inventário já estão emprestados.
ALTER TABLE equipment_loans ADD COLUMN equipment_inventory_id TEXT;
CREATE INDEX idx_equipment_loans_inventory ON equipment_loans(equipment_inventory_id);
