// E-mail de prazo de devolução enviado ao solicitante quando um empréstimo de
// equipamento é registrado (aba Empréstimo de Equipamentos). Dois textos, da
// T.I.: um pro período da manhã (devolver até 10h) e outro pro da noite (até 22h).
import { queueEmail, flushOutbox } from './email.js'

const HELP_EMAIL = 'meajuda@fecaf.com.br'

const VARIANTS = {
  manha: {
    subject: 'Prazo para devolução de equipamentos – período da manhã (até às 10h)',
    intro: 'Informamos que todos os equipamentos retirados junto à equipe de T.I. no período da manhã (Chromebooks, controles de projetor, caixas de som, entre outros) devem ser devolvidos até às 10h.',
    reason: 'A devolução dentro desse horário é essencial para que possamos conferir, carregar e preparar os equipamentos para o uso dos demais colegas nos períodos seguintes.',
  },
  noite: {
    subject: 'Prazo para devolução de equipamentos – até às 22h',
    intro: 'Informamos que todos os equipamentos retirados junto à equipe de T.I. (Chromebooks, controles de projetor, caixas de som, entre outros) devem ser devolvidos até às 22h do mesmo dia da retirada.',
    reason: 'A devolução dentro desse horário é essencial para que possamos conferir, carregar e preparar os equipamentos para o uso dos demais colegas no dia seguinte.',
  },
}

export const DEADLINE_PERIODS = Object.keys(VARIANTS)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Mensagem rápida avulsa (✉️ na lista de empréstimos). Diferente do aviso de
// prazo, AQUI o resultado importa pra quem clicou — então devolve
// { ok, error } em vez de engolir a falha. Mesmo visual simples, em nome da T.I.
export async function sendLoanQuickMessage(env, db, { to, requesterName, loan, message, loanId }) {
  const itemLine = `${loan.equipment_model}${loan.patrimony ? ` (${loan.patrimony})` : ''}`
  const greeting = `Prezado(a) ${requesterName},`
  const text = [greeting, '', message, '', `Equipamento: ${itemLine}`, '', 'Atenciosamente,', 'Equipe de T.I.'].join('\n')
  const p = t => `<p style="margin:0 0 14px;">${t}</p>`
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">`
    + p(esc(greeting))
    + p(esc(message).replace(/\n/g, '<br>'))
    + p(`<span style="color:#666;">Equipamento: ${esc(itemLine)}</span>`)
    + p('Atenciosamente,<br>Equipe de T.I.')
    + '</div>'

  const outboxId = await queueEmail(db, {
    to_email: to, subject: `Equipamento emprestado – ${loan.equipment_model}`, html, text,
    related_type: 'equipment_loan_message', related_id: loanId, plain: true,
  })
  const result = await flushOutbox(env, db)
  const row = await db.prepare('SELECT status, error FROM email_outbox WHERE id = ?').get(outboxId)
  if (row?.status === 'sent') return { ok: true }
  if (!result.provider) return { ok: false, error: 'Nenhum provedor de e-mail configurado.' }
  return { ok: false, error: row?.error || result.error || 'Falha ao enviar o e-mail.' }
}

// `loans`: linhas recém-criadas ({ equipment_model, patrimony }). Enfileira e
// já tenta despachar (sem esperar o ciclo de 15 min do cron). Nunca lança —
// falha no e-mail não pode desfazer o empréstimo já registrado.
export async function sendLoanDeadlineEmail(env, db, { to, requesterName, period, loans, loanId }) {
  try {
    const v = VARIANTS[period]
    if (!v || !to?.includes('@')) return false

    const itemLines = loans.map(l => `${l.equipment_model}${l.patrimony ? ` (${l.patrimony})` : ''}`)
    const greeting = `Prezado(a) ${requesterName},`
    const itemsIntro = itemLines.length === 1 ? 'Equipamento registrado em seu nome:' : 'Equipamentos registrados em seu nome:'
    const closing = `Caso precisem utilizar algum equipamento além desse horário, pedimos que abram previamente um chamado pelo e-mail ${HELP_EMAIL}.`

    const text = [
      greeting, '', itemsIntro, ...itemLines.map(i => `- ${i}`), '', v.intro, '', v.reason, '', closing, '',
      'Contamos com a colaboração de todos.', '', 'Atenciosamente,', 'Equipe de T.I.',
    ].join('\n')

    const p = t => `<p style="margin:0 0 14px;">${t}</p>`
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">`
      + p(esc(greeting))
      + p(`${esc(itemsIntro)}<br>${itemLines.map(i => `• ${esc(i)}`).join('<br>')}`)
      + p(esc(v.intro)) + p(esc(v.reason))
      + p(esc(closing).replace(HELP_EMAIL, `<a href="mailto:${HELP_EMAIL}">${HELP_EMAIL}</a>`))
      + p('Contamos com a colaboração de todos.')
      + p('Atenciosamente,<br>Equipe de T.I.')
      + '</div>'

    await queueEmail(db, { to_email: to, subject: v.subject, html, text, related_type: 'equipment_loan', related_id: loanId, plain: true })
    await flushOutbox(env, db)
    return true
  } catch (e) {
    console.error('E-mail de prazo de devolução falhou', e.message)
    return false
  }
}
