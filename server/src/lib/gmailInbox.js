// Respostas por e-mail → "chat" do Empréstimo de Equipamentos.
//
// Os avisos de empréstimo (mensagem rápida ✉️ e prazo de devolução) saem pela
// caixa do Gmail configurada em lib/email.js. Quando o solicitante responde, a
// resposta cai nessa caixa — este módulo procura essas respostas e grava cada
// uma em `equipment_loan_messages` (direction='in'), que é o mesmo histórico
// mostrado na janela de mensagem.
//
// Como liga a resposta ao empréstimo:
//   1. pelo fio (threadId) do Gmail, guardado em email_outbox.provider_thread_id
//      no envio — o jeito certo, vale pra tudo enviado a partir de out/2026;
//   2. senão (e-mail enviado antes disso), pelo remetente + assunto: a resposta
//      vem de quem recebeu o e-mail e o assunto é o mesmo, só com "Re:".
//
// Leitura: só a busca abaixo (assuntos dos avisos de empréstimo, últimos 30
// dias, fora os enviados pela própria caixa) — o resto da caixa nunca é baixado.
// Autenticação, na ordem:
//   a) o mesmo token OAuth do envio (GMAIL_REFRESH_TOKEN), se ele tiver escopo
//      de leitura;
//   b) a Service Account (GOOGLE_SA_*, Delegação em todo o domínio) com o escopo
//      gmail.readonly autorizado no Admin Console, se passando pela caixa
//      GMAIL_INBOX_EMAIL (ou GMAIL_SENDER_EMAIL).
// O resultado da última rodada fica em app_settings.gmail_inbox_status (JSON),
// pra diagnóstico.
import { SignJWT, importPKCS8 } from 'jose'
import { v4 as uuid } from 'uuid'
import { getGmailAccessToken } from './email.js'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const LOAN_TYPES = ['equipment_loan_message', 'equipment_loan']
// Assuntos dos e-mails de empréstimo (lib/loanDeadlineEmail.js). Mudou lá → muda aqui.
const SEARCH = 'in:inbox -from:me newer_than:30d subject:("Equipamento emprestado" OR "Prazo para devolução")'
const IGNORED_SENDERS = /mailer-daemon|postmaster|no-?reply/i

const DEFAULT_SENDER = 'helpdesk.ti@fecaf.com.br' // mesmo padrão de email.js

export function gmailInboxConfigured(env) {
  const oauth = env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN
  const sa = env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY
  return !!(oauth || sa)
}

async function serviceAccountToken(env) {
  const key = env.GOOGLE_SA_PRIVATE_KEY.includes('\\n') ? env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n') : env.GOOGLE_SA_PRIVATE_KEY
  const privateKey = await importPKCS8(key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({ scope: READ_SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.GOOGLE_SA_EMAIL)
    .setSubject(env.GMAIL_INBOX_EMAIL || env.GMAIL_SENDER_EMAIL || DEFAULT_SENDER)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!res.ok) throw new Error(`Service Account (gmail.readonly) respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return (await res.json()).access_token
}

async function gmailGet(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = new Error(`Gmail respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return await res.json()
}

// Lista as mensagens da busca tentando cada forma de autenticação. Devolve o
// token que funcionou (pra baixar as mensagens) e qual foi.
async function listCandidates(env) {
  const path = `/messages?maxResults=25&q=${encodeURIComponent(SEARCH)}`
  const errors = []
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) {
    try {
      const token = await getGmailAccessToken(env)
      return { token, auth: 'oauth', messages: (await gmailGet(token, path)).messages || [] }
    } catch (e) { errors.push(`oauth: ${e.message}`) } // 403 = token só tem escopo de envio → tenta a Service Account
  }
  if (env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY) {
    try {
      const token = await serviceAccountToken(env)
      return { token, auth: 'service_account', messages: (await gmailGet(token, path)).messages || [] }
    } catch (e) { errors.push(`service_account: ${e.message}`) }
  }
  throw new Error(errors.join(' | ') || 'Nenhuma credencial do Google configurada')
}

// ── Leitura da mensagem ────────────────────────────────────────────────────

function decodeBase64Url(data) {
  const b64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)))
}

function findPart(payload, mime) {
  if (!payload) return null
  if (payload.mimeType === mime && payload.body?.data) return payload.body.data
  for (const p of payload.parts || []) {
    const found = findPart(p, mime)
    if (found) return found
  }
  return null
}

function htmlToText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*$/i, '') // Gmail/Outlook põem a mensagem citada num blockquote
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

export function messageText(payload) {
  const plain = findPart(payload, 'text/plain')
  if (plain) return decodeBase64Url(plain)
  const html = findPart(payload, 'text/html')
  return html ? htmlToText(decodeBase64Url(html)) : ''
}

// Só o que a pessoa escreveu: corta a mensagem citada ("Em ..., X escreveu:",
// "> ...", cabeçalho do Outlook "De: ... Enviado:"), a assinatura ("-- ") e
// as marcações de imagem da assinatura ("[image: ...]").
export function cleanReply(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n')
  const cuts = [
    /\n[ \t]*(Em|On)\s[^\n]*(\n[^\n]*)?\s(escreveu|wrote)\s*:/i, // Gmail (a linha às vezes quebra em duas)
    /\n[ \t]*-{2,}\s*(Mensagem original|Original Message)/i,
    /\n[ \t]*_{8,}/, // separador do Outlook
    /\n[ \t]*(De|From)\s*:\s[^\n]+\n[ \t]*(Enviad[oa]|Sent|Data|Date|Para|To)\s*:/i,
    /\n>/,
    /\n-- ?\n/,
  ]
  t = '\n' + t
  for (const re of cuts) {
    const m = t.match(re)
    if (m) t = t.slice(0, m.index)
  }
  return t
    .split('\n').filter(l => !/^\s*\[(image|imagem):[^\]]*\]\s*$/i.test(l)).join('\n')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

const header = (msg, name) => msg.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || ''
const emailOf = from => (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()
// "Re: RES: Fwd: Assunto" → "Assunto"
export const baseSubject = s => String(s || '').replace(/^\s*((re|res|enc|fwd?|tr|aw)\s*:\s*)+/i, '').trim()
const sqlDate = ms => new Date(Number(ms) || Date.now()).toISOString().replace('T', ' ').slice(0, 19)

// ── Rodada ─────────────────────────────────────────────────────────────────

async function saveStatus(db, status) {
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('gmail_inbox_status', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ at: new Date().toISOString(), ...status }))
}

// Procura respostas novas e grava no chat. `maxGets` limita quantas mensagens
// são baixadas por rodada (cada uma é 1 subrequest — plano Free: 50/execução).
// Devolve { matched, loanIds } — quem chamou decide se avisa o tempo real.
export async function syncLoanReplies(env, db, { maxGets = 10 } = {}) {
  if (!gmailInboxConfigured(env)) return { skipped: true, matched: 0, loanIds: [] }

  let listed
  try {
    listed = await listCandidates(env)
  } catch (e) {
    await saveStatus(db, { ok: false, error: e.message })
    throw e
  }
  const { token, auth, messages } = listed
  if (!messages.length) {
    await saveStatus(db, { ok: true, auth, listed: 0, matched: 0 })
    return { matched: 0, loanIds: [] }
  }

  const ph = list => list.map(() => '?').join(',')
  const ids = messages.map(m => m.id)
  const done = new Set((await db.prepare(`SELECT id FROM gmail_processed WHERE id IN (${ph(ids)})`).all(...ids)).map(r => r.id))
  const fresh = messages.filter(m => !done.has(m.id)).slice(0, maxGets)
  if (!fresh.length) {
    await saveStatus(db, { ok: true, auth, listed: messages.length, matched: 0 })
    return { matched: 0, loanIds: [] }
  }

  const threadIds = [...new Set(fresh.map(m => m.threadId))]
  const byThread = new Map((await db.prepare(
    `SELECT provider_thread_id, related_id FROM email_outbox WHERE provider_thread_id IN (${ph(threadIds)}) AND related_type IN (${ph(LOAN_TYPES)})`
  ).all(...threadIds, ...LOAN_TYPES)).map(r => [r.provider_thread_id, r.related_id]))

  const writes = []
  const loanIds = new Set()
  const ownBox = (env.GMAIL_INBOX_EMAIL || env.GMAIL_SENDER_EMAIL || DEFAULT_SENDER).toLowerCase()
  for (const m of fresh) {
    let msg
    try {
      msg = await gmailGet(token, `/messages/${m.id}?format=full`)
    } catch (e) {
      console.error('Gmail: falha ao baixar mensagem', m.id, e.message)
      continue // não marca como vista — tenta de novo na próxima rodada
    }
    writes.push({ sql: 'INSERT OR IGNORE INTO gmail_processed (id) VALUES (?)', args: [m.id] })

    const from = emailOf(header(msg, 'from'))
    if (!from || from === ownBox || IGNORED_SENDERS.test(from)) continue

    let loanId = byThread.get(m.threadId)
    if (!loanId) {
      const row = await db.prepare(`
        SELECT related_id FROM email_outbox
        WHERE lower(to_email) = ? AND subject = ? AND related_type IN (${ph(LOAN_TYPES)}) AND status = 'sent'
        ORDER BY created_at DESC LIMIT 1
      `).get(from, baseSubject(header(msg, 'subject')), ...LOAN_TYPES)
      loanId = row?.related_id
    }
    if (!loanId) continue

    const text = cleanReply(messageText(msg.payload)) || String(msg.snippet || '').slice(0, 500) || '(resposta sem texto)'
    writes.push({
      sql: `INSERT OR IGNORE INTO equipment_loan_messages (id, loan_id, to_email, message, status, direction, from_email, gmail_message_id, created_at, imported_at)
            SELECT ?, ?, ?, ?, 'received', 'in', ?, ?, ?, datetime('now') WHERE EXISTS (SELECT 1 FROM equipment_loans WHERE id = ?)`,
      args: [uuid(), loanId, ownBox, text, from, m.id, sqlDate(msg.internalDate), loanId],
    })
    loanIds.add(loanId)
  }
  writes.push({ sql: "DELETE FROM gmail_processed WHERE created_at < datetime('now', '-45 days')", args: [] })
  await db.batch(writes)

  await saveStatus(db, { ok: true, auth, listed: messages.length, fetched: fresh.length, matched: loanIds.size })
  return { matched: loanIds.size, loanIds: [...loanIds] }
}

// A última rodada (cron ou chat aberto) foi há mais de 7 min? → o cron de 1 min
// roda de novo mesmo fora dos minutos x3/x8 (recupera rodada que falhou). 1 consulta.
export async function gmailInboxOverdue(db) {
  const raw = await db.scalar("SELECT value FROM app_settings WHERE key = 'gmail_inbox_status'")
  let at = 0
  try { at = Date.parse(JSON.parse(raw || '{}').at) || 0 } catch { /* status ilegível → atrasado */ }
  return Date.now() - at > 7 * 60_000
}

// Pra quando alguém abre o chat: no máximo 1 rodada a cada 20 s (várias
// pessoas/abas abrindo ao mesmo tempo não multiplicam as chamadas ao Gmail).
export async function syncLoanRepliesThrottled(env, db) {
  if (!gmailInboxConfigured(env)) return { skipped: true, matched: 0, loanIds: [] }
  const last = await db.scalar("SELECT value FROM app_settings WHERE key = 'gmail_inbox_last_sync'")
  if (last && Date.now() - Date.parse(last) < 20_000) return { throttled: true, matched: 0, loanIds: [] }
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('gmail_inbox_last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString())
  return await syncLoanReplies(env, db)
}
