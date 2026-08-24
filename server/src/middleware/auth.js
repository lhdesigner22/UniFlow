import { verifyJwt } from '../lib/jwt.js'

// Middleware Hono — equivalente ao middleware Express de antes, mas
// usando `c.set('user', ...)` / `c.get('user')` em vez de `req.user`.
export async function auth(c, next) {
  const header = c.req.header('Authorization')
  if (!header) return c.json({ error: 'Token não fornecido' }, 401)
  const token = header.split(' ')[1]
  try {
    c.set('user', await verifyJwt(token, c.env.JWT_SECRET))
    await next()
  } catch {
    return c.json({ error: 'Token inválido' }, 401)
  }
}
