// E2E: resposta por e-mail do solicitante aparece no chat do Empréstimo.
// Precisa do servidor de teste com o Gmail de mentira:
//   cd server && MOCK_GMAIL=1 node test-e2e/node-server.mjs
//   node test-e2e/loan-replies-e2e.mjs
import { SignJWT } from 'jose'
import { cleanReply, baseSubject, messageText } from '../src/lib/gmailInbox.js'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const admin = await new SignJWT({ id: 'u-test', name: 'u-test', email: 'teste@colegioser.com', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const mock = async (path, body) => (await fetch(BASE + '/__mock' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json()
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// ── Limpeza do texto da resposta (funções puras) ─────────────────────────
const gmailReply = 'Bom dia Pessoal,\nJá solicitei ao responsável para devolver o equipamento com urgência.\n\n[image: assinatura]\n\nEm seg., 20 de out. de 2026 às 07:37, UniFlow <\nhelpdesk.ti@fecaf.com.br> escreveu:\n\n> Prezado(a) Samantha Rasquinho,\n> Lembrete: por favor, devolva o equipamento.\n'
expect('Gmail: só o que a pessoa escreveu', cleanReply(gmailReply), 'Bom dia Pessoal,\nJá solicitei ao responsável para devolver o equipamento com urgência.')
const outlookReply = 'Devolvo amanhã cedo.\r\n\r\n________________________________\r\nDe: UniFlow <helpdesk.ti@fecaf.com.br>\r\nEnviado: segunda-feira, 20 de outubro de 2026 07:37\r\nPara: Fulano\r\n'
expect('Outlook: corta o cabeçalho citado', cleanReply(outlookReply), 'Devolvo amanhã cedo.')
expect('Inglês: "On ... wrote:"', cleanReply('Ok, thanks!\n\nOn Mon, Oct 20, 2026 at 7:37 AM UniFlow <x@y> wrote:\n> hi'), 'Ok, thanks!')
expect('Assinatura "-- " cortada', cleanReply('Já devolvi.\n-- \nFulano\nCoordenação'), 'Já devolvi.')
expect('Assunto: tira Re:/RES:', baseSubject('RES: Re: Equipamento emprestado – Caixa de som Ativa'), 'Equipamento emprestado – Caixa de som Ativa')
expect('Só HTML: vira texto e corta o blockquote', cleanReply(messageText({ mimeType: 'text/html', body: { data: Buffer.from('<div>Devolvi agora<br>Obrigada</div><blockquote>antigo</blockquote>').toString('base64url') } })), 'Devolvi agora\nObrigada')

// ── Fluxo completo ───────────────────────────────────────────────────────
let r = await call('POST', '/api/equipment-loans', { requester_name: 'Samantha Rasquinho', requester_email: 'samantha.rasquinho@fecaf.com.br', equipment_model: 'Caixa de som Ativa', building: 'sede' })
const loan = r.j?.loans?.[0] || r.j?.[0] || r.j
expect('cria o empréstimo', !!loan?.id, true)

r = await call('POST', `/api/equipment-loans/${loan.id}/message`, { message: 'Lembrete: por favor, devolva o equipamento à T.I. assim que possível.' })
expect('envia a mensagem rápida', r.s, 200)
const sent = await mock('/gmail/sent')
expect('Gmail recebeu o envio', sent.length, 1)

// Resposta no MESMO fio do Gmail (caso normal)
await mock('/gmail/inbox', {
  id: 'in-1', threadId: sent[0].threadId, from: 'Samantha Rasquinho <samantha.rasquinho@fecaf.com.br>',
  subject: 'Re: Equipamento emprestado – Caixa de som Ativa', text: gmailReply, internalDate: Date.now() + 1000,
})
// Mensagem que não tem nada a ver (outra pessoa, outro assunto) — não pode entrar
await mock('/gmail/inbox', { id: 'in-x', threadId: 'outro-fio', from: 'alguem@fecaf.com.br', subject: 'Re: Reunião', text: 'nada a ver' })

r = await call('GET', `/api/equipment-loans/${loan.id}/messages?check=1`)
const incoming = (r.j || []).filter(m => m.direction === 'in')
expect('abrir o chat traz a resposta', incoming.length, 1)
expect('...com o texto limpo', incoming[0]?.message, 'Bom dia Pessoal,\nJá solicitei ao responsável para devolver o equipamento com urgência.')
expect('...e o remetente', incoming[0]?.from_email, 'samantha.rasquinho@fecaf.com.br')
expect('a mensagem enviada continua lá', (r.j || []).filter(m => m.direction === 'out').length, 1)

// Resposta a um e-mail ANTIGO (enviado antes de guardar o fio): casa por remetente + assunto, pelo cron
await mock('/gmail/inbox', {
  id: 'in-2', threadId: 'fio-antigo', from: 'samantha.rasquinho@fecaf.com.br',
  subject: 'RES: Equipamento emprestado – Caixa de som Ativa', text: 'Já devolvi na sala da T.I.', internalDate: Date.now() + 2000,
})
await mock('/cron', { cron: '* * * * *', minute: 3 })
await mock('/cron', { cron: '* * * * *', minute: 3 }) // de novo: não pode duplicar
r = await call('GET', `/api/equipment-loans/${loan.id}/messages`)
const inc2 = (r.j || []).filter(m => m.direction === 'in')
expect('cron trouxe a resposta do e-mail antigo (sem duplicar)', inc2.length, 2)
expect('a mensagem sem relação não entrou', (r.j || []).some(m => m.message === 'nada a ver'), false)

// Bolinha de "resposta nova" na lista: entra resposta depois de abrirem o chat
// (as datas têm precisão de segundo — espera virar o segundo)
await new Promise(res => setTimeout(res, 1100))
await mock('/gmail/inbox', { id: 'in-3', threadId: sent[0].threadId, from: 'samantha.rasquinho@fecaf.com.br', subject: 'Re: Equipamento emprestado – Caixa de som Ativa', text: 'Ah, e o cabo também.', internalDate: Date.now() + 60_000 })
await mock('/cron', { cron: '* * * * *', minute: 8 })
r = await call('GET', '/api/equipment-loans')
const row = (r.j?.loans || r.j || []).find(l => l.id === loan.id)
expect('lista avisa resposta nova', !!row?.last_reply_at && row.last_reply_at > (row.replies_seen_at || ''), true)
await call('GET', `/api/equipment-loans/${loan.id}/messages`)
r = await call('GET', '/api/equipment-loans')
const row2 = (r.j?.loans || r.j || []).find(l => l.id === loan.id)
expect('abrir o chat apaga o aviso', row2.last_reply_at > row2.replies_seen_at, false)

// Fora do minuto 3/8 o cron NÃO lê a caixa (fica com as filas do GLPI)
await mock('/gmail/inbox', { id: 'in-4', threadId: sent[0].threadId, from: 'samantha.rasquinho@fecaf.com.br', subject: 'Re: x', text: 'quarta' })
await mock('/cron', { cron: '* * * * *', minute: 4 })
r = await call('GET', `/api/equipment-loans/${loan.id}/messages`)
expect('minuto 4: caixa não é lida (última leitura recente)', (r.j || []).filter(m => m.direction === 'in').length, 3)

// Rodada que falhou: última leitura há mais de 7 min → o minuto seguinte (fora do x3/x8) recupera
await mock('/setting', { key: 'gmail_inbox_status', value: JSON.stringify({ at: new Date(Date.now() - 10 * 60_000).toISOString(), ok: true }) })
await mock('/cron', { cron: '* * * * *', minute: 4 })
r = await call('GET', `/api/equipment-loans/${loan.id}/messages`)
expect('última leitura atrasada: minuto 4 lê a caixa e recupera', (r.j || []).filter(m => m.direction === 'in').length, 4)
const fresh = JSON.parse((await mock('/setting?key=gmail_inbox_status'))?.value || '{}')
expect('...e o status volta a ficar em dia', Date.now() - Date.parse(fresh.at) < 60_000, true)

// Token OAuth só com permissão de ENVIO → usa a Service Account
await mock('/gmail/mode', { oauthCanRead: false })
await mock('/gmail/inbox', { id: 'in-5', threadId: sent[0].threadId, from: 'samantha.rasquinho@fecaf.com.br', subject: 'Re: x', text: 'quinta' })
await mock('/cron', { cron: '* * * * *', minute: 13 })
r = await call('GET', `/api/equipment-loans/${loan.id}/messages`)
expect('sem leitura no OAuth: Service Account traz a resposta', (r.j || []).filter(m => m.direction === 'in').length, 5)
const status = JSON.parse((await mock('/setting?key=gmail_inbox_status'))?.value || '{}')
expect('status registra a Service Account', status.auth, 'service_account')

// Novos envios guardam o fio (threadId) no outbox
r = await call('POST', `/api/equipment-loans/${loan.id}/message`, { message: 'Obrigado!' })
expect('segundo envio ok', r.s, 200)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
