import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import { connectLive } from '../lib/liveHub.js'

// Entrada do tempo real. O navegador não consegue mandar o header
// Authorization num WebSocket, então ele pede antes um "ticket" (vale 60s,
// assinado com uma chave DIFERENTE da dos tokens de login — por isso o ticket
// não serve pra chamar nenhuma outra rota) e conecta com ele na URL.
const app = new Hono()

const ticketKey = env => `${env.JWT_SECRET}:live`

// POST /ticket — precisa estar logado
app.post('/ticket', auth, async c => {
  const ticket = await signJwt({ id: c.get('user').id, purpose: 'live' }, ticketKey(c.env), '60s')
  return c.json({ ticket })
})

// GET /ws?ticket=... — abre o WebSocket
app.get('/ws', async c => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected websocket', 426)
  if (!c.env.LIVE_HUB) return c.text('Tempo real indisponível', 503)
  try {
    const payload = await verifyJwt(c.req.query('ticket') || '', ticketKey(c.env))
    if (payload.purpose !== 'live') throw new Error('ticket inválido')
  } catch {
    return c.text('Ticket inválido ou expirado', 401)
  }
  return connectLive(c.env, c.req.raw)
})

export default app
