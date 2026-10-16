-- Usuários e configurações mínimas pros testes locais (rode DEPOIS das migrações).
INSERT OR REPLACE INTO users (id, name, email, password, system_role, role_id) VALUES
 ('u-test', 'Teste Live', 'teste@colegioser.com', 'x', 'super_admin', 'role-super-admin'),
 ('u-col',  'Colab',      'u-col@colegioser.com',  'x', 'user',        'role-colaborador'),
 ('u-ana',  'Analista',   'u-ana@colegioser.com',  'x', 'user',        'role-analista'),
 ('u-aud',  'Auditor',    'u-aud@colegioser.com',  'x', 'auditor',     'role-auditor'),
 ('u-sem',  'Sem cargo',  'u-sem@colegioser.com',  'x', 'user',        NULL);
INSERT INTO app_settings (key, value) VALUES ('glpi_enabled', 'true'), ('glpi_status_id', '17'), ('glpi_entity_id', '4')
 ON CONFLICT(key) DO UPDATE SET value = excluded.value;
