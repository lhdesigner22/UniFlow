import { verifyJwt } from '../lib/jwt.js'

// Middleware Hono — equivalente ao middleware Express de antes, mas
// usando `c.set('user', ...)` / `c.get('user')` em vez de `req.user`.
//
// Aceita o token tanto no header Authorization (uso normal, via axios) quanto
// em `?token=` na query string — precisa disso pra download de arquivo (anexo
// da Base de Conhecimento/Impressoras): um <a href> nativo do navegador não
// manda header customizado, mas assim o download já sai direto do navegador
// (com a barra de progresso dele) em vez de esperar o JS baixar o arquivo
// inteiro num blob antes de salvar — é isso que causava a demora percebida.
export async function auth(c, next) {
  const header = c.req.header('Authorization')
  const token = header ? header.split(' ')[1] : c.req.query('token')
  if (!token) return c.json({ error: 'Token não fornecido' }, 401)
  try {
    c.set('user', await verifyJwt(token, c.env.JWT_SECRET))
    await next()
  } catch {
    return c.json({ error: 'Token inválido' }, 401)
  }
}
