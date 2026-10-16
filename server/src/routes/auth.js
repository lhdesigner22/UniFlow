import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { verifyPassword } from '../lib/password.js'
import { signJwt } from '../lib/jwt.js'
import { verifyGoogleIdToken, decodeJwtPayload } from '../lib/googleAuth.js'
import { auth } from '../middleware/auth.js'
import { loadAccess } from '../lib/permissions.js'

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

// Cadastro por e-mail/senha desativado — a entrada agora é só via Google
// (conta corporativa). Rota mantida (410 Gone) em vez de removida, caso
// algum cliente antigo (app instalado como PWA, aba com cache velho) ainda
// tente chamar.
app.post('/register', c => c.json({ error: 'Cadastro por e-mail/senha desativado. Entre com sua conta Google.' }, 410))

app.post('/login', async c => {
  const db = c.get('db')
  const { email, password } = await c.req.json()
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !(await verifyPassword(password, user.password)))
    return c.json({ error: 'Credenciais inválidas' }, 401)

  await autoPromote(db, c.env, user.id, user.email)
  user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  const token = await signJwt({ id: user.id, name: user.name, email: user.email, tv: user.token_version || 0 }, c.env.JWT_SECRET)
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
      // Sempre sincroniza com a foto ATUAL do Google (não só na primeira
      // vez) — antes só gravava se `avatar` estivesse vazio, então quem
      // adicionava/trocava a foto no Google depois de já ter uma conta
      // aqui nunca via a atualização. Só não sobrescreve se o Google não
      // mandar `picture` nesse login (mantém o que já tinha).
      await db.prepare('UPDATE users SET google_id = ?, avatar = ? WHERE id = ?')
        .run(googleId, picture || user.avatar || null, user.id)
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
    const token = await signJwt({ id: user.id, name: user.name, email: user.email, tv: user.token_version || 0 }, c.env.JWT_SECRET)
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
  const tokenUser = c.get('user')
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.system_role, u.department_id, u.created_at, u.token_version,
           d.name as department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(tokenUser.id)
  if (!user) return c.json({ error: 'Usuário não encontrado' }, 401)

  // Se um Super Admin "forçou novo login" dessa conta (ver POST
  // /admin/users/:id/force-relogin), o token_version do banco já andou —
  // o token que a pessoa ainda carrega tem o valor antigo, então nem
  // precisa esperar os 7 dias de expiração normais: já barra aqui.
  if ((tokenUser.tv || 0) !== (user.token_version || 0)) {
    return c.json({ error: 'Sessão renovada — faça login novamente.' }, 401)
  }

  // Pro Sidebar decidir se mostra o link do Cofre de Senhas (acesso não
  // segue o system_role normal — ver server/src/routes/vault.js).
  if (user.system_role === 'super_admin') {
    user.has_vault_access = true
  } else {
    const grant = await db.prepare('SELECT 1 FROM vault_access WHERE user_id = ?').get(user.id)
    user.has_vault_access = !!grant
  }

  // Cargo, permissões por módulo e escopo (todos os departamentos ou só o dele) —
  // o front usa isso pra esconder menus/botões. A regra de verdade é aplicada
  // no servidor (worker.js); isto é só pra interface não mostrar o que não vale.
  const access = await loadAccess(db, user.id)
  user.role_id = access.roleId || (user.system_role === 'super_admin' ? 'role-super-admin' : user.system_role === 'auditor' ? 'role-auditor' : 'role-colaborador')
  user.role_name = access.roleName
  user.permissions = access.permissions
  user.scope = access.scope

  return c.json(user)
})

app.put('/me', auth, async c => {
  const db = c.get('db')
  const { name, avatar } = await c.req.json()
  await db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(name, avatar, c.get('user').id)
  return c.json({ ok: true })
})

export default app
