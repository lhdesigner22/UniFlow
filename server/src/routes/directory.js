import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { directorySearchByName, directoryConfigured } from '../lib/directoryClient.js'

// Busca no diretório do Google Workspace pelo nome — qualquer usuário
// logado pode usar (mesmo tipo de busca que já dá pra fazer manualmente no
// Gmail/Contatos, só automatizada pro formulário de Empréstimo de Equip.).
const app = new Hono()
app.use('*', auth)

// GET /lookup?name=...
app.get('/lookup', async c => {
  const name = c.req.query('name')?.trim()
  if (!name) return c.json({ error: 'Informe name' }, 400)
  if (!directoryConfigured(c.env)) return c.json({ error: 'Diretório do Google ainda não configurado.' }, 503)

  try {
    const match = await directorySearchByName(c.env, name)
    return c.json(match)
  } catch (e) {
    console.error(`[directory] erro pra "${name}": ${e.message}`)
    return c.json({ error: `Falha ao buscar no diretório: ${e.message}` }, 502)
  }
})

export default app
