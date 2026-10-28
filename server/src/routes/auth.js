import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { signJwt } from '../lib/jwt.js'
import { verifyGoogleIdToken, decodeJwtPayload } from '../lib/googleAuth.js'
import { auth } from '../middleware/auth.js'
import { signDownloadTicket } from '../lib/requestToken.js'
import { rateLimit, byIp, byUser } from '../lib/rateLimit.js'
import { loadAccess } from '../lib/permissions.js'
import { auditInBackground } from '../lib/audit.js'

const app = new Hono()

// E-mails que sempre recebem super_admin automaticamente
const OWNER_EMAILS = ['luiz.sanchez@colegioser.com']

// Únicos domínios que podem entrar (ver POST /google).
const ALLOWED_LOGIN_DOMAINS = ['colegioser.com', 'fecaf.com.br', 'pro.fecaf.com.br']

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

// Login por e-mail/senha também desativado (out/2026): não tinha limite de
// tentativas nem a restrição de domínio do Google. 410, igual ao /register.
app.post('/login', c => c.json({ error: 'Login por e-mail/senha desativado. Entre com sua conta Google.' }, 410))

app.post('/google', rateLimit('LOGIN_LIMITER', byIp, 'Muitas tentativas de login — espere um minuto.'), async c => {
  const db = c.get('db')
  const { credential } = await c.req.json()
  if (!credential) return c.json({ error: 'Token não fornecido' }, 400)
  if (!c.env.GOOGLE_CLIENT_ID || c.env.GOOGLE_CLIENT_ID.startsWith('SEU_')) {
    return c.json({ error: 'Google OAuth não configurado. Adicione GOOGLE_CLIENT_ID nos secrets do Worker.' }, 501)
  }

  try {
    // 0. Diagnóstico: decodifica o token sem verificar para comparar audience
    // (o detalhe fica só no log — a resposta não expõe a configuração).
    try {
      const tokenAud = decodeJwtPayload(credential).aud
      if (tokenAud !== c.env.GOOGLE_CLIENT_ID) {
        console.error('❌ GOOGLE_CLIENT_ID MISMATCH! token aud:', tokenAud, ' configurado:', c.env.GOOGLE_CLIENT_ID)
        return c.json({ error: 'Configuração incorreta do Google OAuth (GOOGLE_CLIENT_ID). Contate o administrador.' }, 401)
      }
    } catch { /* se falhar a decodificação, tenta verificar mesmo assim */ }

    // 1. Verificar token com Google
    const payload = await verifyGoogleIdToken(credential, c.env.GOOGLE_CLIENT_ID)
    const { email, name, picture, sub: googleId } = payload

    // 2. E-mail verificado pelo Google + restrição de domínio. A lista é fixa
    // no código (decisão do Luiz, out/2026): antes dependia do secret opcional
    // ALLOWED_DOMAIN e, sem ele, QUALQUER conta Google entrava como Colaborador.
    // Domínio inteiro — conta de aluno (@a.fecaf.com.br) não entra.
    if (payload.email_verified !== true) {
      return c.json({ error: 'E-mail da conta Google não verificado.' }, 403)
    }
    const emailDomain = String(email || '').split('@')[1]?.toLowerCase()
    if (!ALLOWED_LOGIN_DOMAINS.includes(emailDomain)) {
      auditInBackground(c, { category: 'auth', action: 'auth.denied', severity: 'warning', status: 403, user: { id: null, name: name || null, email: email || null }, targetLabel: 'domínio não permitido' })
      return c.json({ error: `Acesso restrito a contas ${ALLOWED_LOGIN_DOMAINS.map(d => '@' + d).join(', ')}. Use seu e-mail corporativo.` }, 403)
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

    // Primeiro acesso de quem não virou Super Admin: recebe o cargo padrão
    // (Admin → Cargos). Só cargos comuns — nunca Super Admin/Auditor por padrão.
    if (isNewUser && user.system_role === 'user' && !user.role_id) {
      const role = await db.prepare(`
        SELECT r.id FROM app_settings s JOIN roles r ON r.id = s.value
        WHERE s.key = 'default_role_id' AND r.system_role = 'user'
      `).get()
      if (role) {
        await db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role.id, user.id)
        user.role_id = role.id
      }
    }

    // 5. Emitir JWT igual ao login normal
    const token = await signJwt({ id: user.id, name: user.name, email: user.email, tv: user.token_version || 0 }, c.env.JWT_SECRET)
    auditInBackground(c, { category: 'auth', action: 'auth.login', user: { id: user.id, name: user.name, email: user.email }, details: isNewUser ? { primeiro_acesso: true } : undefined })
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
      userError = 'Falha na autenticação com Google. Tente novamente.'
    }
    return c.json({ error: userError }, 401)
  }
})

// POST /download-ticket {path} — ticket de 60s para baixar UM anexo por <a href>
// (ver lib/requestToken.js). Só caminhos de anexo; o acesso ao arquivo é
// checado de novo quando o navegador baixa.
const DOWNLOAD_PATH = /^\/api\/[a-z-]+\/[\w-]+\/attachment$/
app.post('/download-ticket', auth, rateLimit('SECRET_LIMITER', byUser, 'Muitos downloads em pouco tempo — espere um minuto.'), async c => {
  const { path } = await c.req.json().catch(() => ({}))
  if (typeof path !== 'string' || !DOWNLOAD_PATH.test(path)) return c.json({ error: 'Caminho de download inválido' }, 400)
  return c.json({ ticket: await signDownloadTicket(c.env, c.get('user'), path) })
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
  // Foto só por https (vira <img src>); nome obrigatório e com tamanho limitado.
  if (!String(name || '').trim() || String(name).length > 120) return c.json({ error: 'Nome inválido' }, 400)
  if (avatar && !/^https:\/\//i.test(String(avatar))) return c.json({ error: 'Foto inválida' }, 400)
  await db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(String(name).trim(), avatar || null, c.get('user').id)
  return c.json({ ok: true })
})

export default app
