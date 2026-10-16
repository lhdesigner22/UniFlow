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
//
// Sessão revogada ("Forçar novo login" → token_version andou) ou usuário
// excluído: o portão de acesso do worker.js já barra quando passou por ele
// (c.get('access') presente). Nos recursos que ele pula (auth, notifications,
// live) a checagem é feita aqui — 1 consulta.
export async function auth(c, next) {
  const header = c.req.header('Authorization')
  const token = header ? header.split(' ')[1] : c.req.query('token')
  if (!token) return c.json({ error: 'Token não fornecido' }, 401)
  let payload
  try {
    payload = await verifyJwt(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Token inválido' }, 401)
  }
  if (!c.get('access')) {
    const u = await c.get('db').prepare('SELECT token_version FROM users WHERE id = ?').get(payload.id)
    if (!u) return c.json({ error: 'Usuário não encontrado — faça login novamente.' }, 401)
    if ((payload.tv || 0) !== (u.token_version || 0)) return c.json({ error: 'Sessão renovada — faça login novamente.' }, 401)
  }
  c.set('user', payload)
  await next()
}
