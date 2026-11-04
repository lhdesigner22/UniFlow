// Portal do Professor — o que routes/teacher.js (lado do professor) e
// routes/chromebookRequests.js (lado da TI) compartilham.
import { queueEmail, flushOutbox } from './email.js'

export const BUILDINGS = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }
export const REQUEST_STATUSES = ['pendente', 'aprovada', 'recusada', 'cancelada']
// Tipos de chamado que o professor escolhe (o rótulo vai no título do chamado no GLPI).
export const TICKET_KINDS = {
  computador: 'Computador / notebook',
  projetor: 'Projetor / TV',
  internet: 'Internet / Wi-Fi',
  acesso: 'Acesso / senha',
  outro: 'Outro problema',
}
export const MAX_CHROMEBOOKS = 60
export const MAX_DAYS_AHEAD = 60

// Hoje no horário de Brasília (YYYY-MM-DD). toISOString é UTC: depois das 21h
// já seria amanhã.
export const todayBrasilia = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const brDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
export const describeRequest = r =>
  `${r.quantity} Chromebook${r.quantity > 1 ? 's' : ''} · ${brDate(r.use_date)}, ${r.start_time}–${r.end_time} · ${BUILDINGS[r.building] || r.building}, ${r.room}`

// Avisa todos os que podem confirmar pedidos (cargo com Empréstimos "editar" ou
// Super Admin) no sininho — um INSERT só, sem consulta por pessoa.
export function notifyLoanEditors(db, title, content) {
  return db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, content, link)
    SELECT lower(hex(randomblob(16))), u.id, 'chromebook', ?, ?, '/pedidos-chromebook'
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.system_role = 'super_admin' OR json_extract(r.permissions, '$.loans') = 'edit'
  `).run(title, content)
}

// E-mail ao professor com a resposta da TI. Nunca lança: a decisão já foi gravada.
export async function sendDecisionEmail(env, db, { to, name, request, decision, note }) {
  try {
    if (!to?.includes('@')) return
    const ok = decision === 'aprovada'
    const lines = [
      `Olá, ${name}!`,
      ok ? 'Seu pedido de Chromebooks foi confirmado pela equipe de T.I.' : 'Seu pedido de Chromebooks não pôde ser atendido.',
      describeRequest(request),
      note ? `${ok ? 'Observação' : 'Motivo'}: ${note}` : '',
      ok ? 'Retire os equipamentos com a equipe de T.I. no horário combinado.' : 'Se precisar, faça um novo pedido em outro horário pelo UniFlow.',
      'Equipe de T.I.',
    ].filter(Boolean)
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">'
      + lines.map(l => `<p style="margin:0 0 12px;">${esc(l)}</p>`).join('') + '</div>'
    await queueEmail(db, {
      to_email: to,
      subject: ok ? 'Pedido de Chromebooks confirmado' : 'Pedido de Chromebooks recusado',
      html, text: lines.join('\n\n'), related_type: 'chromebook_request', related_id: request.id, plain: true,
    })
    await flushOutbox(env, db)
  } catch (e) {
    console.error('[teacher] e-mail da decisão falhou:', e.message)
  }
}
