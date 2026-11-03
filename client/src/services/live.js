// Tempo real: mantém um WebSocket aberto com o servidor e avisa as telas
// quando algo mudou em OUTRO aparelho. O aviso diz só "o recurso X mudou" —
// cada tela busca os dados de novo pela API normal (com as permissões de
// sempre). Ver server/src/lib/liveHub.js.
//
// Robustez: reconecta sozinho (com espera crescente), manda "ping" a cada 25s
// pra conexão não ser derrubada por inatividade, e, sempre que a conexão
// volta ou a aba volta a ficar visível depois de um tempo escondida, avisa
// TODAS as telas pra recarregar — assim nada fica desatualizado por causa de
// um aviso perdido (computador que dormiu, rede que caiu etc.).
import api from './api'
import { clientId } from './clientId'

const DEBOUNCE_MS = 400            // vários avisos seguidos viram uma única recarga
const HEARTBEAT_MS = 25_000
const HIDDEN_CATCHUP_MS = 20_000   // escondida por mais que isso → recarrega ao voltar
// Trava contra laço de reconexão (nov/2026: o app estourou as 100 mil chamadas/dia
// do plano grátis num fim de semana). Se a conexão abre e cai logo em seguida, a
// espera NÃO volta a zero — só depois de ficar de pé 1 min. E a recarga geral da
// reconexão acontece no máximo a cada 5 min (cada uma são várias chamadas).
const STABLE_MS = 60_000
const MIN_RECONNECT_MS = 5_000
const RECONNECT_CATCHUP_MS = 5 * 60_000

const listeners = new Set() // { resources: Set | null, fn, timer }
let socket = null
let started = false
let attempt = 0
let reconnectTimer = null
let heartbeat = null
let everConnected = false
let hiddenAt = null
let openedAt = null
let lastCatchup = 0

function dispatch(msg) {
  for (const l of listeners) {
    const matches = msg.r === '*' || !l.resources || l.resources.has(msg.r)
    if (!matches) continue
    clearTimeout(l.timer)
    l.timer = setTimeout(() => { try { l.fn(msg) } catch (e) { console.error('live listener', e) } }, DEBOUNCE_MS)
  }
}

function clearTimers() {
  clearInterval(heartbeat); heartbeat = null
  clearTimeout(reconnectTimer); reconnectTimer = null
}

async function connect() {
  if (!started || socket || !localStorage.getItem('token')) return
  let ticket
  try {
    ticket = (await api.post('/live/ticket')).data.ticket
  } catch {
    return scheduleReconnect()
  }
  if (!started) return

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/api/live/ws?ticket=${encodeURIComponent(ticket)}`)
  socket = ws

  ws.onopen = () => {
    openedAt = Date.now()
    clearInterval(heartbeat)
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping') }, HEARTBEAT_MS)
    // Reconexão: pode ter perdido avisos enquanto estava fora → recarrega tudo.
    if (everConnected && Date.now() - lastCatchup > RECONNECT_CATCHUP_MS) { lastCatchup = Date.now(); dispatch({ r: '*' }) }
    everConnected = true
  }
  ws.onmessage = e => {
    if (e.data === 'pong') return
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    if (msg.c && msg.c === clientId) return // alteração feita por esta própria aba
    dispatch(msg)
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    clearInterval(heartbeat); heartbeat = null
    if (openedAt && Date.now() - openedAt >= STABLE_MS) attempt = 0 // ficou de pé: queda normal
    openedAt = null
    scheduleReconnect()
  }
  ws.onerror = () => { try { ws.close() } catch { /* já fechado */ } }
}

function scheduleReconnect() {
  if (!started || reconnectTimer) return
  const wait = Math.max(MIN_RECONNECT_MS, Math.min(30_000, 1000 * 2 ** attempt)) + Math.random() * 500
  attempt++
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, wait)
}

function onVisibility() {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
  const away = hiddenAt ? Date.now() - hiddenAt : 0
  hiddenAt = null
  if (!socket) { attempt = 0; clearTimeout(reconnectTimer); reconnectTimer = null; connect() }
  else if (away > HIDDEN_CATCHUP_MS) dispatch({ r: '*' })
}

function onOnline() {
  if (!socket) { attempt = 0; clearTimeout(reconnectTimer); reconnectTimer = null; connect() }
}

export function startLive() {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  connect()
}

export function stopLive() {
  started = false
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('online', onOnline)
  clearTimers()
  const ws = socket
  socket = null
  everConnected = false
  if (ws) { ws.onclose = null; try { ws.close() } catch { /* já fechado */ } }
}

// `resources`: lista de recursos ('equipment-loans', 'boards'...) ou null = qualquer um.
// Devolve a função que cancela a inscrição.
export function subscribeLive(resources, fn) {
  const l = { resources: resources ? new Set(resources) : null, fn, timer: null }
  listeners.add(l)
  return () => { clearTimeout(l.timer); listeners.delete(l) }
}
