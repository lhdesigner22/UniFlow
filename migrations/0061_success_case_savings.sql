-- Cases de Sucesso → "Save financeiro": quanto cada entrega economizou.
-- saving_period diz como ler o valor: 'unico' (uma vez), 'mensal' ou 'anual'.
-- O total do painel soma tudo no ano (mensal × 12). Ver routes/successCases.js.
ALTER TABLE success_cases ADD COLUMN saving_value REAL;
ALTER TABLE success_cases ADD COLUMN saving_period TEXT;
ALTER TABLE success_cases ADD COLUMN saving_note TEXT;
