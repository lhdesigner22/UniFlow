import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { signJwt } from '../lib/jwt.js'
import { verifyGoogleIdToken, decodeJwtPayload } from '../lib/googleAuth.js'
import { auth } from '../middleware/auth.js'

const app = new Hono()

// E-mails que sempre recebem super_admin automaticamente
const OWNER_EMAILS = ['luiz.sanchez@colegioser.com']

// Auto-promove donos e e-mails listados em SUPER_ADMIN_EMAILS para super_admin
async function autoPromote(db, env, userId, email) {
  const envList = (env.SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const fullList = [...new Set([...OWNER_EMAILS.map(e => e.toLowerCase()), ...envList])]
  if (fullList.includes(email.toLowerCase())) {
    await db.prepare("UPDATE users SET system_role = 'super_admin' WHERE id = ?").run(userId)
  }
}

app.get('/health', c => c.json({ ok: true }))

app.post('/register', async c => {
  const db = c.get('db')
  const { name, email, password } = await c.req.json()
  if (!name || !email || !password) return c.json({ error: 'Campos obrigatórios' }, 400)
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) return c.json({ error: 'E-mail já cadastrado' }, 409)

  const hash = await hashPassword(password)
  const id = uuid()
  await db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(id, name, email, hash)

  // Primeiro usuário do sistema vira super_admin automaticamente
  // (antes rodava a cada boot em db.js; agora é decidido na hora do cadastro)
  const totalUsers = await db.scalar('SELECT COUNT(*) FROM users')
  if (totalUsers === 1) {
    await db.prepare("UPDATE users SET system_role = 'super_admin' WHERE id = ?").run(id)
  } else {
    await autoPromote(db, c.env, id, email)
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  const token = await signJwt({ id, name, email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id, name, email, system_role: user.system_role } })
})

app.post('/login', async c => {
  const db = c.get('db')
  const { email, password } = await c.req.json()
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !(await verifyPassword(password, user.password)))
    return c.json({ error: 'Credenciais inválidas' }, 401)

  await autoPromote(db, c.env, user.id, user.email)
  user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  const token = await signJwt({ id: user.id, name: user.name, email: user.email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, system_role: user.system_role } })
})

app.post('/google', async c => {
  const db = c.get('db')
  const { credential } = await c.req.json()
  if (!credential) return c.json({ error: 'Token não fornecido' }, 400)
  if (!c.env.GOOGLE_CLIENT_ID || c.env.GOOGLE_CLIENT_ID.startsWith('SEU_')) {
    return c.json({ error: 'Google OAuth não configurado. Adicione GOOGLE_CLIENT_ID nos secrets do Worker.' }, 501)
  }

  try {
    // 0. Diagnóstico: decodifica o token sem verificar para comparar audience
    try {
      const rawPayload = decodeJwtPayload(credential)
      const tokenAud = rawPayload.aud
      const configuredId = c.env.GOOGLE_CLIENT_ID
      if (tokenAud !== configuredId) {
        console.error('❌ GOOGLE_CLIENT_ID MISMATCH! token aud:', tokenAud, ' configurado:', configuredId)
        return c.json({
          error: `GOOGLE_CLIENT_ID incorreto no servidor. Token foi emitido para "${tokenAud}" mas o servidor espera "${configuredId}". Corrija a variável GOOGLE_CLIENT_ID.`
        }, 401)
      }
    } catch { /* se falhar a decodificação, tenta verificar mesmo assim */ }

    // 1. Verificar token com Google
    const payload = await verifyGoogleIdToken(credential, c.env.GOOGLE_CLIENT_ID)
    const { email, name, picture, sub: googleId } = payload

    // 2. Restrição de domínio (opcional)
    if (c.env.ALLOWED_DOMAIN && c.env.ALLOWED_DOMAIN.trim() !== '') {
      const allowed = c.env.ALLOWED_DOMAIN.split(',').map(d => d.trim().toLowerCase())
      const emailDomain = email.split('@')[1]?.toLowerCase()
      if (!allowed.includes(emailDomain)) {
        return c.json({ error: `Acesso restrito ao domínio: ${c.env.ALLOWED_DOMAIN}. Use seu e-mail corporativo.` }, 403)
      }
    }

    // 3. Encontrar ou criar usuário
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    let isNewUser = false
    if (!user) {
      isNewUser = true
      const id = uuid()
      await db.prepare('INSERT INTO users (id, name, email, password, avatar, google_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, email, '', picture || null, googleId)
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    } else {
      await db.prepare('UPDATE users SET google_id = ?, avatar = CASE WHEN avatar IS NULL OR avatar = "" THEN ? ELSE avatar END WHERE id = ?')
        .run(googleId, picture || null, user.id)
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    }

    // 4. Primeiro usuário do sistema vira super_admin; senão, checa SUPER_ADMIN_EMAILS
    if (isNewUser) {
      const totalUsers = await db.scalar('SELECT COUNT(*) FROM users')
      if (totalUsers === 1) await db.prepare("UPDATE users SET system_role = 'super_admin' WHERE id = ?").run(user.id)
    }
    await autoPromote(db, c.env, user.id, user.email)
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)

    // 5. Emitir JWT igual ao login normal
    const token = await signJwt({ id: user.id, name: user.name, email: user.email }, c.env.JWT_SECRET)
    return c.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, system_role: user.system_role } })

  } catch (e) {
    console.error('Google OAuth error:', e.message)
    console.error('  → GOOGLE_CLIENT_ID configurado:', c.env.GOOGLE_CLIENT_ID ? 'SIM' : 'NÃO')

    const msg = e.message?.toLowerCase() || ''
    let userError
    if (msg.includes('used too late') || msg.includes('expired')) {
      userError = 'Token Google expirado. Tente novamente.'
    } else if (msg.includes('audience') || msg.includes('invalid token signature') || msg.includes('wrong number of segments') || msg.includes('claim')) {
      userError = 'Configuração incorreta do Google OAuth (GOOGLE_CLIENT_ID). Contate o administrador.'
    } else if (msg.includes('invalid_grant') || msg.includes('invalid token')) {
      userError = 'Token Google inválido. Tente novamente.'
    } else {
      userError = `Falha na autenticação com Google: ${e.message}`
    }
    return c.json({ error: userError }, 401)
  }
})

app.get('/me', auth, async c => {
  const db = c.get('db')
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.system_role, u.department_id, u.created_at,
           d.name as department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(c.get('user').id)
  return c.json(user)
})

app.put('/me', auth, async c => {
  const db = c.get('db')
  const { name, avatar } = await c.req.json()
  await db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(name, avatar, c.get('user').id)
  return c.json({ ok: true })
})

export default app
