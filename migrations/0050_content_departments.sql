-- Separação por departamento: cada conteúdo passa a pertencer a um departamento
-- (department_id). NULL = "Geral", visível a todos os departamentos. Quem tem
-- cargo com escopo "só o próprio departamento" enxerga o conteúdo do seu
-- departamento + o Geral; quem tem escopo "todos" enxerga tudo.
--
-- Fora desta lista, de propósito:
--   - Quadros/cartões: já são separados por dono e membros.
--   - Aprovações: são fluxos entre pessoas (só quem pediu ou decide enxerga).
--   - Time (Desempenho/Jornada): o departamento vem da própria pessoa (users.department_id).
--   - Cofre e VLANs: têm lista própria de acesso.
ALTER TABLE events ADD COLUMN department_id TEXT;
ALTER TABLE printers ADD COLUMN department_id TEXT;
ALTER TABLE equipment_loans ADD COLUMN department_id TEXT;
ALTER TABLE equipment_inventory ADD COLUMN department_id TEXT;
ALTER TABLE purchase_requests ADD COLUMN department_id TEXT;
ALTER TABLE kb_articles ADD COLUMN department_id TEXT;
ALTER TABLE company_branches ADD COLUMN department_id TEXT;
ALTER TABLE partners ADD COLUMN department_id TEXT;
ALTER TABLE internet_links ADD COLUMN department_id TEXT;
ALTER TABLE org_chart_nodes ADD COLUMN department_id TEXT;
ALTER TABLE org_chart_free_lines ADD COLUMN department_id TEXT;

-- O que já existe fica no departamento de quem criou; sem criador conhecido
-- (ex: eventos importados do GLPI, criados pelo sistema) vai pro TI — todo o
-- conteúdo de hoje foi criado pela equipe de TI. Departamentos novos começam vazios.
UPDATE events SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = events.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE printers SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = printers.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE equipment_loans SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = equipment_loans.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE equipment_inventory SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = equipment_inventory.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE purchase_requests SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = purchase_requests.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE kb_articles SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = kb_articles.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE company_branches SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = company_branches.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE partners SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = partners.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE internet_links SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = internet_links.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE org_chart_nodes SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = org_chart_nodes.created_by), (SELECT id FROM departments WHERE name = 'TI'));
UPDATE org_chart_free_lines SET department_id = COALESCE((SELECT u.department_id FROM users u WHERE u.id = org_chart_free_lines.created_by), (SELECT id FROM departments WHERE name = 'TI'));

-- Departamento dos eventos que a sincronização do GLPI cria na Agenda (editável no Admin → GLPI).
INSERT OR IGNORE INTO app_settings (key, value) SELECT 'glpi_department_id', id FROM departments WHERE name = 'TI';

CREATE INDEX IF NOT EXISTS idx_events_department ON events(department_id);
CREATE INDEX IF NOT EXISTS idx_loans_department ON equipment_loans(department_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_department ON purchase_requests(department_id);
