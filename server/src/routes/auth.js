import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuid } from 'uuid'
import { OAuth2Client } from 'google-auth-library'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()

// E-mails que sempre recebem super_admin automaticamente
const OWNER_EMAILS = ['luiz.sanchez@colegioser.com']

// Auto-promove donos e e-mails listados em SUPER_ADMIN_EMAILS para super_admin
async function autoPromote(userId, email) {
  const envList = (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const fullList = [...new Set([...OWNER_EMAILS.map(e => e.toLowerCase()), ...envList])]
  if (fullList.includes(email.toLowerCase())) {
    await db.prepare("UPDATE users SET system_role = 'super_admin' WHERE id = ?").run(userId)
  }
}

router.get('/health', (_req, res) => res.json({ ok: true }))

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios' })
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) return res.status(409).json({ error: 'E-mail já cadastrado' })
  const hash = bcrypt.hashSync(password, 10)
  const id = uuid()
  await db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(id, name, email, hash)
  const token = jwt.sign({ id, name, email }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id, name, email } })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Credenciais inválidas' })
  await autoPromote(user.id, user.email)
  user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, system_role: user.system_role } })
})

router.post('/google', async (req, res) => {
  const { credential } = req.body
  if (!credential) return res.status(400).json({ error: 'Token não fornecido' })
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.startsWith('SEU_')) {
    return res.status(501).json({ error: 'Google OAuth não configurado. Adicione GOOGLE_CLIENT_ID no .env do servidor.' })
  }

  try {
    // 1. Verificar token com Google
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    const { email, name, picture, sub: googleId } = payload

    // 2. Restrição de domínio (opcional)
    if (process.env.ALLOWED_DOMAIN && process.env.ALLOWED_DOMAIN.trim() !== '') {
      const allowed = process.env.ALLOWED_DOMAIN.split(',').map(d => d.trim().toLowerCase())
      const emailDomain = email.split('@')[1]?.toLowerCase()
      if (!allowed.includes(emailDomain)) {
        return res.status(403).json({
          error: `Acesso restrito ao domínio: ${process.env.ALLOWED_DOMAIN}. Use seu e-mail corporativo.`
        })
      }
    }

    // 3. Encontrar ou criar usuário
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user) {
      // Novo usuário via Google
      const id = uuid()
      await db.prepare('INSERT INTO users (id, name, email, password, avatar, google_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, email, '', picture || null, googleId)
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    } else {
      // Vincular Google a conta existente e atualizar avatar se não tiver
      await db.prepare('UPDATE users SET google_id = ?, avatar = CASE WHEN avatar IS NULL OR avatar = "" THEN ? ELSE avatar END WHERE id = ?')
        .run(googleId, picture || null, user.id)
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    }

    // 4. Auto-promover se email estiver em SUPER_ADMIN_EMAILS
    await autoPromote(user.id, user.email)
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)

    // 5. Emitir JWT igual ao login normal
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, system_role: user.system_role } })

  } catch (e) {
    console.error('Google OAuth error:', e.message)
    res.status(401).json({ error: 'Falha na autenticação com Google. Token inválido ou expirado.' })
  }
})

router.get('/me', auth, async (req, res) => {
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.system_role, u.department_id, u.created_at,
           d.name as department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(req.user.id)
  res.json(user)
})

router.put('/me', auth, async (req, res) => {
  const { name, avatar } = req.body
  await db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(name, avatar, req.user.id)
  res.json({ ok: true })
})

export default router
