// Disjuntor das chamadas à API (nov/2026). Duas vezes uma aba entrou em laço e
// sozinha estourou as 100 mil chamadas/dia do plano grátis da Cloudflare (o app
// inteiro sai do ar até 21h): a reconexão do tempo real e o "sair" com sessão
// inválida. Em vez de esperar o próximo laço aparecer, a aba se protege: se fizer
// chamadas demais, ou falhar demais, num minuto, para de chamar a API e pede para
// recarregar a página. Uso normal fica muito abaixo: ~15 chamadas por tela aberta.

const WINDOW_MS = 60_000
export const MAX_REQUESTS = 200 // chamadas por minuto
export const MAX_FAILURES = 20  // 401, 429, 5xx ou sem resposta, por minuto

let requests = []
let failures = []
let open = false

const prune = (list, now) => list.filter(t => now - t < WINDOW_MS)

function trip(reason) {
  if (open) return
  open = true
  console.warn(`[disjuntor] chamadas à API pausadas nesta aba: ${reason}`)
  try { window.dispatchEvent(new CustomEvent('app:circuit-open', { detail: { reason } })) } catch { /* sem window */ }
}

// Antes de cada chamada. false = disjuntor aberto, não chame.
export function allowRequest(now = Date.now()) {
  if (open) return false
  requests = prune(requests, now)
  requests.push(now)
  if (requests.length > MAX_REQUESTS) trip(`${requests.length} chamadas em 1 minuto`)
  return !open
}

// Depois de cada resposta com erro (status ausente = sem resposta / rede).
export function recordFailure(status, now = Date.now()) {
  if (status && status < 500 && status !== 401 && status !== 429) return // 400/403/404/409: resposta normal de regra
  failures = prune(failures, now)
  failures.push(now)
  if (failures.length > MAX_FAILURES) trip(`${failures.length} falhas em 1 minuto`)
}

export const isCircuitOpen = () => open

// Só para os testes.
export function resetCircuit() { requests = []; failures = []; open = false }
