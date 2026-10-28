import { signJwt, verifyJwt } from './jwt.js'

// Quem está fazendo a requisição. Duas formas aceitas:
//   1. header `Authorization: Bearer <token de login>` — o normal (axios);
//   2. `?ticket=` — SÓ para baixar arquivo por <a href> nativo (o navegador não
//      manda header): ticket de 60s, assinado com chave própria, preso ao
//      caminho exato do arquivo e só para GET. Antes ia o token de login inteiro
//      na URL (`?token=`), que fica no histórico, em logs e em prints — e valia 48h
//      para o sistema todo.
// Devolve o payload do usuário ({ id, name, email, tv }), ou null se não veio
// credencial; lança erro se veio e é inválida.
const ticketKey = env => `${env.JWT_SECRET}:download`

export async function tokenPayload(c) {
  const header = c.req.header('Authorization')
  if (header) return await verifyJwt(header.split(' ')[1] || '', c.env.JWT_SECRET)

  const ticket = c.req.query('ticket')
  if (!ticket || c.req.method !== 'GET') return null
  const p = await verifyJwt(ticket, ticketKey(c.env))
  if (p.purpose !== 'download' || p.path !== c.req.path) throw new Error('ticket de outro arquivo')
  return { id: p.id, name: p.name, email: p.email, tv: p.tv }
}

// Ticket de download para `path` (ex: /api/kb/123/attachment) — quem pede já
// passou pela auth; o acesso ao arquivo em si é checado de novo na hora de baixar.
export async function signDownloadTicket(env, user, path) {
  const { id, name, email, tv } = user
  return await signJwt({ id, name, email, tv, purpose: 'download', path }, ticketKey(env), '60s')
}
