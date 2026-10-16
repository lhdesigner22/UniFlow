# Testes locais de ponta a ponta

Rodam contra o Worker **local** (`wrangler dev --local`, D1 local — nada de produção) com tokens JWT
assinados por nós. Servem pra validar permissões, departamentos, tempo real e a integração com o GLPI
(um GLPI de mentira em `mock-glpi.mjs`) **sem precisar logar com o Google**.

## Preparar (uma vez)
```bash
cd <raiz do projeto>
npm run build                      # os testes servem client/dist
STATE=.wrangler/test-state         # onde o banco local fica (já ignorado pelo git)
CFG=server/test-e2e/wrangler.test.jsonc
npx wrangler d1 migrations apply uniflow --local --persist-to $STATE -c $CFG
npx wrangler d1 execute uniflow --local --persist-to $STATE -c $CFG --file server/test-e2e/seed-base.sql
npx wrangler d1 execute uniflow --local --persist-to $STATE -c $CFG --file server/test-e2e/dept-seed.sql   # dept TI/RH + usuários d-*
```

## Subir os servidores (2 terminais, ou em segundo plano)
```bash
node server/test-e2e/mock-glpi.mjs                       # GLPI de mentira na porta 8798
npx wrangler dev -c $CFG --local --port 8799 --persist-to $STATE --test-scheduled \
  --var JWT_SECRET:testsecret --var GLPI_BASE_URL:http://127.0.0.1:8798 \
  --var GLPI_APP_TOKEN:t --var GLPI_USER_TOKEN:t
```
Reinicie o `wrangler dev` sempre que mudar código do servidor (às vezes não recarrega sozinho).

## Rodar (de dentro de `server/`, pra resolver o pacote `jose`)
```bash
cd server
node test-e2e/roles-e2e.mjs     # cargos: acesso por módulo, só-leitura, cargo travado, Auditor
node test-e2e/dept-e2e.mjs      # departamentos (rode antes: dept-seed.sql, que também limpa o conteúdo)
node test-e2e/entity-e2e.mjs    # Chamados por entidade do GLPI (precisa do mock)
node test-e2e/dup-e2e.mjs       # importação em lote + duplicatas + fila em segundo plano (precisa do mock)
node test-e2e/live-e2e.mjs      # tempo real (WebSocket)
node test-e2e/test-dups3.mjs    # unitário das regras de duplicata
```
Entre as suítes, limpe o que a anterior deixou (ex.: `DELETE FROM events; DELETE FROM glpi_duplicate_tickets; ...`
— veja os `DELETE` no topo de cada teste/seed). Cada teste imprime `OK`/`FALHA` e `TUDO OK` no fim.

No navegador do app local: abra `http://127.0.0.1:8799/login` e rode no console
`localStorage.setItem('token', '<jwt assinado com testsecret>')`.
