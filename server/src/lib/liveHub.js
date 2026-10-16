// Tempo real: um Durable Object ("hub") mantém as conexões WebSocket de todos
// os aparelhos abertos e repassa um aviso curto a cada mudança feita no
// sistema ("equipment-loans mudou"). O aviso NÃO carrega dado nenhum — o
// navegador recebe, e busca de novo pela API normal (que já aplica as
// permissões de cada pessoa). Assim ninguém vê, por esse canal, nada que não
// poderia ver pela tela.
//
// Usa a API de hibernação de WebSocket: o hub "dorme" entre mensagens (não
// gasta tempo de execução parado) e o ping/pong do navegador é respondido
// pela própria plataforma, sem nem acordar o código.
import { DurableObject } from 'cloudflare:workers'

export class LiveHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request) {
    const url = new URL(request.url)

    // Chamado pelo Worker depois de uma alteração — repassa o aviso a todos.
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const message = await request.text()
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(message) } catch { /* conexão já caiu — ignora */ }
      }
      return new Response('ok')
    }

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // O navegador não manda nada além de "ping" (tratado no auto-response).
  webSocketMessage() {}
  webSocketClose(ws, code) { try { ws.close(code) } catch { /* já fechado */ } }
}

function hubStub(env) {
  return env.LIVE_HUB.get(env.LIVE_HUB.idFromName('global'))
}

// Avisa todos os aparelhos conectados que `resource` mudou. Nunca lança —
// um problema no tempo real não pode derrubar a operação que acabou de dar certo.
//   msg: { r: recurso ('equipment-loans'), b?: id do quadro, p?: caminho, c?: id do aparelho que fez a alteração }
export async function broadcastLive(env, msg) {
  if (!env.LIVE_HUB) return
  try {
    await hubStub(env).fetch('https://live/broadcast', { method: 'POST', body: JSON.stringify({ ...msg, t: Date.now() }) })
  } catch (e) {
    console.error('Falha no broadcast em tempo real', e.message)
  }
}

export function connectLive(env, request) {
  return hubStub(env).fetch(request)
}
