import { tokenPayload } from '../lib/requestToken.js'

// Middleware Hono — equivalente ao middleware Express de antes, mas
// usando `c.set('user', ...)` / `c.get('user')` em vez de `req.user`.
//
// Aceita o token no header Authorization (uso normal, via axios) ou um ticket
// curto de download em `?ticket=` (anexo da Base de Conhecimento/Impressoras,
// baixado por <a href> nativo pra ter a barra de progresso do navegador) —
// ver lib/requestToken.js.
//
// Sessão revogada ("Forçar novo login" → token_version andou) ou usuário
// excluído: o portão de acesso do worker.js já barra quando passou por ele
// (c.get('access') presente). Nos recursos que ele pula (auth, notifications,
// live) a checagem é feita aqui — 1 consulta.
export async function auth(c, next) {
  let payload
  try {
    payload = await tokenPayload(c)
  } catch {
    return c.json({ error: 'Token inválido' }, 401)
  }
  if (!payload) return c.json({ error: 'Token não fornecido' }, 401)
  if (!c.get('access')) {
    const u = await c.get('db').prepare('SELECT token_version FROM users WHERE id = ?').get(payload.id)
    if (!u) return c.json({ error: 'Usuário não encontrado — faça login novamente.' }, 401)
    if ((payload.tv || 0) !== (u.token_version || 0)) return c.json({ error: 'Sessão renovada — faça login novamente.' }, 401)
  }
  c.set('user', payload)
  await next()
}
