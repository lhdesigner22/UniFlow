import api from '../services/api'

// Um único "Atualizar agora" pros três painéis que dependem do GLPI (Backlog
// de Chamados, Total de Chamados e a sincronização de Eventos da Agenda) —
// clicar em qualquer um dos botões dispara os três juntos, em vez do admin
// ter que visitar cada página e clicar em botões separados (e sem precisar
// abrir mais sessões no GLPI do que o necessário: o refresh do backlog já
// atualiza o cache de técnicos, e o do total reaproveita esse cache pronto
// em vez de baixá-lo de novo — ver server/src/routes/glpiTotal.js).
//
// Ordem: primeiro o backlog (que também recalcula o cache de técnicos),
// DEPOIS total + eventos em paralelo — assim o snapshot do Total já nasce
// usando o cache de técnicos fresquinho, sem corrida entre as duas chamadas.
// Cada POST aqui é uma invocação de Worker separada (não uma coisa só), o
// que é de propósito: já tivemos "Too many subrequests by single Worker
// invocation" no passado ao empilhar sincronizações pesadas do GLPI numa
// única execução — mantendo cada uma na sua própria requisição HTTP, cada
// uma fica com seu próprio teto de 50 subrequests do plano Free.
export async function refreshAllGlpi() {
  const backlog = await api.post('/glpi-backlog/refresh').catch(e => e)
  const [total, events] = await Promise.all([
    api.post('/glpi-total/refresh').catch(e => e),
    api.post('/admin/glpi/sync-now').catch(e => e),
  ])

  const results = { backlog, total, events }
  const allFailed = Object.values(results).every(r => r instanceof Error)
  if (allFailed) throw backlog

  return results
}
