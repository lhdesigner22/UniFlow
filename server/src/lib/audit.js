import { createNotification } from '../routes/notifications.js'

// Logs de auditoria (tabela audit_logs, migração 0062; tela em Admin → Logs).
//
// Três jeitos de cair aqui:
//   1. middleware do worker.js — QUALQUER alteração (POST/PUT/PATCH/DELETE) e
//      exportação, em segundo plano, sem mexer rota por rota;
//   2. POST /api/audit/view — o app avisa a cada tela aberta;
//   3. chamadas diretas com mais detalhe: Cofre de Senhas e senhas de Wi-Fi das
//      VLANs (abrir, revelar, copiar, criar, editar, excluir, acesso concedido/
//      revogado/negado) e login. No Cofre o registro é feito ANTES de devolver a
//      senha e com await: se o log não gravar, a senha não sai.
//
// Nunca registra senha nem corpo de requisição — só caminho, alvo e um resumo.

const UA_MAX = 200

function who(c) {
  const u = c.get('user') || {}
  return { id: u.id || null, name: u.name || null, email: u.email || null }
}

function clientInfo(c) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || null
  const ua = (c.req.header('User-Agent') || '').slice(0, UA_MAX) || null
  return { ip, ua }
}

// Grava um log. `entry`: { category, action, severity?, targetId?, targetLabel?,
// details? (objeto pequeno), status?, user? (quando ainda não há c.get('user'), ex.: login) }.
export async function writeAudit(c, entry) {
  const user = entry.user || who(c)
  const { ip, ua } = clientInfo(c)
  await c.get('db').prepare(`
    INSERT INTO audit_logs (user_id, user_name, user_email, category, action, severity, method, path, status,
                            target_id, target_label, details, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, user.name, user.email,
    entry.category, entry.action, entry.severity || 'info',
    c.req.method, c.req.path.slice(0, 300), entry.status ?? null,
    entry.targetId ?? null, entry.targetLabel ? String(entry.targetLabel).slice(0, 200) : null,
    entry.details ? JSON.stringify(entry.details).slice(0, 1000) : null,
    ip, ua
  )
}

// Versão "não atrapalha a resposta": grava em segundo plano e, se falhar, só loga no console.
export function auditInBackground(c, entry) {
  const p = writeAudit(c, entry).catch(e => console.error('audit falhou:', e.message))
  try { c.executionCtx.waitUntil(p) } catch { /* fora do Worker (testes): segue sem esperar */ }
}

// ── Alertas do Cofre (sininho dos Super Admins) ─────────────────────────────
export const REVEAL_ALERT_COUNT = 10 // senhas reveladas/copiadas…
const REVEAL_ALERT_MINUTES = 10      // …por uma pessoa em tantos minutos

async function notifySuperAdmins(db, title, content) {
  const admins = await db.prepare("SELECT id FROM users WHERE system_role = 'super_admin'").all()
  for (const a of admins) await createNotification(db, a.id, 'security', title, content, '/admin?tab=logs')
}

// Depois de gravar uma revelação: avisa os Super Admins quando a pessoa chega
// EXATAMENTE no limite (um aviso por rajada, não um por senha). O log da
// revelação já foi gravado; se só o aviso falhar, não impede a pessoa de trabalhar.
export async function checkRevealBurst(c) {
  try { await revealBurst(c) } catch (e) { console.error('alerta do cofre falhou:', e.message) }
}
async function revealBurst(c) {
  const db = c.get('db')
  const user = who(c)
  const n = await db.scalar(`
    SELECT COUNT(*) FROM audit_logs
    WHERE user_id = ? AND action IN ('vault.reveal', 'vault.copy', 'vlan.reveal', 'vlan.copy')
      AND created_at >= datetime('now', ?)
  `, user.id, `-${REVEAL_ALERT_MINUTES} minutes`)
  if (n === REVEAL_ALERT_COUNT) {
    await notifySuperAdmins(db, '⚠️ Cofre de Senhas: muitas senhas vistas',
      `${user.name || user.email} revelou ou copiou ${n} senhas em ${REVEAL_ALERT_MINUTES} minutos. Veja em Admin → Logs.`)
  }
}

// Acesso negado ao Cofre/VLANs: registra sempre; avisa os Super Admins no máximo
// uma vez por hora por pessoa.
export async function auditVaultDenied(c, area) {
  const db = c.get('db')
  const user = who(c)
  const recent = await db.scalar(`
    SELECT COUNT(*) FROM audit_logs
    WHERE user_id = ? AND action = 'vault.denied' AND created_at >= datetime('now', '-1 hour')
  `, user.id)
  await writeAudit(c, { category: 'vault', action: 'vault.denied', severity: 'critical', status: 403, targetLabel: area })
  if (!recent) {
    await notifySuperAdmins(db, '🔒 Tentativa de acesso ao Cofre',
      `${user.name || user.email} tentou abrir ${area} sem autorização.`)
  }
}

// "Abriu o Cofre": a lista é recarregada a cada mudança (tempo real), então
// registra no máximo uma abertura (do mesmo lugar) a cada 5 minutos por pessoa.
export async function auditVaultOpen(c, action, targetLabel) {
  const db = c.get('db')
  const user = who(c)
  const recent = await db.scalar(`
    SELECT COUNT(*) FROM audit_logs
    WHERE user_id = ? AND action = ? AND target_label = ? AND created_at >= datetime('now', '-5 minutes')
  `, user.id, action, targetLabel)
  if (!recent) await writeAudit(c, { category: 'vault', action, targetLabel })
}

// ── Limpeza por idade (cron de 15 min, uma vez por dia) ────────────────────
// Telas abertas: 90 dias. Alterações, logins e exportações: 1 ano.
// Cofre: nunca apaga (é o histórico que mais importa e são poucas linhas).
export async function purgeAuditLogs(db) {
  await db.batch([
    { sql: "DELETE FROM audit_logs WHERE category = 'page' AND created_at < datetime('now', '-90 days')" },
    { sql: "DELETE FROM audit_logs WHERE category IN ('change', 'auth', 'audit') AND created_at < datetime('now', '-365 days')" },
  ])
}
