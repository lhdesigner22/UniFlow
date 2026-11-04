---
name: saude-cloudflare
description: Estudo de saúde do UniFlow na Cloudflare — mede o tráfego do Worker (chamadas por rota, situação e computador) e o banco D1 (leituras/gravações em 24 h e as consultas mais caras), compara com os limites do plano grátis e acha a causa de estouros. Use sempre que chegar e-mail ou print da Cloudflare ("daily request limit", "Observability", "D1 daily operation limit", "usage at 90%"), quando o app cair por limite, ou quando o Luiz pedir estudo/diagnóstico de uso, custo, Workers ou D1 — mesmo que ele só mande o print do e-mail.
---

# Saúde do UniFlow na Cloudflare

O UniFlow roda no plano **grátis** (conta helpdesk.ti@fecaf.com.br): estourar um limite tira o app inteiro do ar até
00:00 UTC (21h de Brasília). Os estouros já vistos foram todos **abas em laço** chamando a API sem parar — uma aba
presa passa sozinha das 100 mil chamadas/dia. Por isso o primeiro passo é sempre olhar o tráfego de agora.

Responda em português do Brasil e em linguagem simples. Nada aqui altera produção: é medição. Correção só com o ok do Luiz.

## Limites do plano grátis

| Recurso | Limite | Observação |
|---|---|---|
| Chamadas ao Worker | 100 mil/dia | estourou = app fora do ar até 21h |
| Eventos de log (observability) | 200 mil/dia | `head_sampling_rate` 0.2 no `wrangler.jsonc`; estourar só para os logs |
| D1 linhas lidas | 5 milhões/dia | |
| D1 linhas gravadas | 100 mil/dia | uma carga de backup grava ~45 mil de uma vez |
| D1 tamanho | 5 GB | |
| Linha do D1 | 2 MB | `glpi_total_raw` (~0,9 MB) tem aviso automático em 1,5 MB |
| CPU por chamada | ~10 ms | |

## Roteiro

1. **Conta certa**: `npx wrangler whoami` tem que mostrar helpdesk.ti (account `fc23b9ee…`). Senão, `npx wrangler login`
   e autorizar em até ~2 min (se o navegador estiver em outra conta, janela anônima).
2. **Tráfego de agora** (60 s bastam — o Luiz não quer esperar):
   ```bash
   timeout 60 npx wrangler tail uniflow --format json > <scratchpad>/trafego.jsonl
   node .claude/skills/saude-cloudflare/scripts/resumo-trafego.mjs <scratchpad>/trafego.jsonl
   ```
   O resumo dá o ritmo por dia, as rotas, a situação (200/401/429…) e os computadores. Sinal de laço: uma rota sozinha
   com mais da metade do tráfego, muitos 401, ou um IP dominando. Só crons (~2 mil/dia) = ninguém usando.
3. **Banco**: `node .claude/skills/saude-cloudflare/scripts/resumo-d1.mjs` — uso em 24 h contra os limites e as 8
   consultas que mais leem e mais gravam. Gravações altas logo depois de uma migração/backup são a carga, não o uso.
4. **Diagnóstico**: compare com os suspeitos conhecidos abaixo; para algo novo, ache no código quem faz a chamada
   (`grep` pela rota em `client/src`) e por que ela se repete.
5. **Relatório** (formato da skill engineering:debug): esperado × medido (tabela com os limites), causa raiz, correção
   proposta, prevenção. Se houver correção: implementar, testar (`cd server && npm test`), mostrar e **publicar só com
   o ok dele**; depois medir de novo e mostrar o antes × depois.
6. Causa nova confirmada → registrar no CLAUDE.md (seção Produção) e acrescentar aqui em "Suspeitos conhecidos".

## Suspeitos conhecidos (já corrigidos — confira se voltaram)

- **Laço de "sair"** (04/11/2026): token inválido → 401 → app faz logout → `POST /api/audit/logout` → 401 → logout…
  Correção: "sair" sem sessão válida responde 200 (`worker.js`). Regra: rota chamada pelo logout/401 nunca responde 401.
- **Laço de reconexão do tempo real** (03/11/2026): `services/live.js` — espera só zera após 1 min conectado, mínimo 5 s,
  recarga geral no máx. a cada 5 min.
- **Disjuntor** (`client/src/services/circuitBreaker.js`): a aba para de chamar a API com mais de 200 chamadas ou 20
  falhas (401/429/5xx/rede) por minuto e pede para recarregar. Se aparecer muito "disjuntor" em reclamação de usuário,
  há laço novo — meça.
- **Sininho**: só recarrega na hora para `boards`, `approvals`, `purchase-requests`, `teacher` (`NOTIFYING_RESOURCES` no Topbar).
- **Portal do Professor**: sem tempo real e sem sininho de propósito (muitos usuários).
- **Leituras**: tabela nova sem índice é o caso clássico (ver CLAUDE.md "Desempenho do banco"); a lista de duplicatas do
  GLPI agora é consultada só pelos chamados da fila (`skipLookup` em `glpiSync.js`).
- **Troca de JWT_SECRET** derruba todas as sessões de uma vez: qualquer caminho que reaja a 401 vira tráfego em massa.
