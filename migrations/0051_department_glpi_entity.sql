-- Entidade do GLPI de cada departamento: Backlog e Total de Chamados mostram, pra
-- cada pessoa, os chamados da entidade do departamento dela. O valor é o nome da
-- entidade como aparece no GLPI ("SERVICE DESK") ou o caminho completo
-- ("Entidade raiz > SERVICE DESK"); casa também com as sub-entidades dela.
-- Departamento sem entidade configurada não vê chamados (só quem enxerga todos
-- os departamentos escolhe a entidade na tela).
ALTER TABLE departments ADD COLUMN glpi_entity_name TEXT;

-- O que já existia: o TI via a entidade SERVICE DESK (fixa no código até aqui).
UPDATE departments SET glpi_entity_name = 'SERVICE DESK' WHERE name = 'TI';
