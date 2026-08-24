// Motor de agendamento (Fase 5) — chamado pelo `scheduled()` do Worker a cada
// tick do Cron Trigger. Duas responsabilidades: varrer regras de SLA (cards
// sem atividade) e disparar os resumos de agenda (semanal/diário), sempre
// via notificação in-app (usuários do sistema) + fila de e-mail (`email_outbox`).
import { v4 as uuid } from 'uuid'
import { createNotification } from '../routes/notifications.js'
import { queueEmail } from './email.js'

async function getSetting(db, key, fallback) {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row?.value ?? fallback
}
async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
}

export async function runSlaSweep(env, db) {
  const rules = await db.prepare('SELECT * FROM sla_rules WHERE active = 1').all()
  for (const rule of rules) {
    try {
      const cards = await db.prepare(`
        SELECT c.*, COALESCE((SELECT MAX(created_at) FROM card_activities WHERE card_id = c.id), c.updated_at) as last_activity
        FROM cards c
        WHERE c.archived = 0
          AND (? IS NULL OR c.board_id = ?)
          AND COALESCE((SELECT MAX(created_at) FROM card_activities WHERE card_id = c.id), c.updated_at) < datetime('now', ?)
      `).all(rule.board_id, rule.board_id, `-${rule.threshold_hours} hours`)

      for (const card of cards) {
        const already = await db.prepare('SELECT * FROM sla_alerts_sent WHERE rule_id = ? AND card_id = ?').get(rule.id, card.id)
        if (already && already.activity_snapshot === card.last_activity) continue // já alertado para esta mesma inatividade

        const recipients = await db.prepare('SELECT * FROM sla_rule_recipients WHERE rule_id = ?').all(rule.id)
        const subject = `SLA: "${card.title}" sem atividade há mais de ${rule.threshold_hours}h`
        const text = `O card "${card.title}" não teve atividade desde ${card.last_activity} (regra "${rule.name}").`
        const html = `<p>O card <strong>${card.title}</strong> não teve atividade desde <strong>${card.last_activity}</strong>.</p><p>Regra: ${rule.name} (limite: ${rule.threshold_hours}h)</p>`

        for (const r of recipients) {
          if (r.user_id) await createNotification(db, r.user_id, 'sla', subject, text, `/boards/${card.board_id}`)
          await queueEmail(db, { to_email: r.email, to_user_id: r.user_id, subject, html, text, related_type: 'sla', related_id: card.id })
        }

        if (already) {
          await db.prepare("UPDATE sla_alerts_sent SET activity_snapshot = ?, alerted_at = datetime('now') WHERE id = ?").run(card.last_activity, already.id)
        } else {
          await db.prepare('INSERT INTO sla_alerts_sent (id, rule_id, card_id, activity_snapshot) VALUES (?, ?, ?, ?)').run(uuid(), rule.id, card.id, card.last_activity)
        }
      }
    } catch (e) { console.error('SLA rule error', rule.id, e.message) }
  }
}

// Expande eventos (incluindo recorrentes) em ocorrências concretas dentro de [from, to] (strings 'YYYY-MM-DD')
export async function expandEventsInRange(db, from, to) {
  const events = await db.prepare('SELECT * FROM events ORDER BY event_date').all()
  const fromD = new Date(from + 'T00:00:00Z')
  const toD = new Date(to + 'T00:00:00Z')
  const occurrences = []
  for (const ev of events) {
    const start = new Date(ev.event_date + 'T00:00:00Z')
    const until = ev.recurrence_until ? new Date(ev.recurrence_until + 'T00:00:00Z') : null
    if (ev.recurrence_type === 'none') {
      if (start >= fromD && start <= toD) occurrences.push({ ...ev, occurrence_date: ev.event_date })
      continue
    }
    // itera dia a dia no intervalo (intervalos são curtos — semana ou mês — ok em JS puro).
    // Math.max/min sobre objetos Date coage via valueOf() (timestamp numérico) — confirmado
    // correto, mas usamos .getTime() explicitamente abaixo pra deixar isso claro no código
    // e não depender de coerção implícita.
    const rangeStartMs = Math.max(fromD.getTime(), start.getTime())
    for (let d = new Date(rangeStartMs); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d < start) continue
      if (until && d > until) break
      const dateStr = d.toISOString().slice(0, 10)
      if (ev.recurrence_type === 'weekly' && d.getUTCDay() === start.getUTCDay()) {
        occurrences.push({ ...ev, occurrence_date: dateStr })
      } else if (ev.recurrence_type === 'monthly' && d.getUTCDate() === start.getUTCDate()) {
        occurrences.push({ ...ev, occurrence_date: dateStr })
      }
    }
  }
  return occurrences.sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
}

export async function runDigests(env, db) {
  const tzOffset = parseInt(await getSetting(db, 'tz_offset_hours', '-3'), 10)
  const now = new Date()
  const localMs = now.getTime() + tzOffset * 3600 * 1000
  const local = new Date(localMs)
  const localHour = local.getUTCHours()
  const localWeekday = local.getUTCDay()
  const localDateStr = local.toISOString().slice(0, 10)

  // Resumo semanal (domingo, hora configurável)
  const weeklyEnabled = (await getSetting(db, 'weekly_digest_enabled', 'false')) === 'true'
  const weeklyWeekday = parseInt(await getSetting(db, 'weekly_digest_weekday', '0'), 10)
  const weeklyHour = parseInt(await getSetting(db, 'weekly_digest_hour', '18'), 10)
  const lastWeekly = await getSetting(db, 'last_weekly_digest_sent', '')
  if (weeklyEnabled && localWeekday === weeklyWeekday && localHour === weeklyHour && lastWeekly !== localDateStr) {
    const weekEnd = new Date(localMs + 6 * 86400000).toISOString().slice(0, 10)
    const occurrences = await expandEventsInRange(db, localDateStr, weekEnd)
    const subject = `Resumo semanal da Agenda (${occurrences.length} evento${occurrences.length === 1 ? '' : 's'})`
    const text = occurrences.length
      ? occurrences.map(o => `- ${o.occurrence_date} ${o.event_time || ''} ${o.title}`).join('\n')
      : 'Nenhum evento agendado para esta semana.'
    const html = `<h2>Resumo semanal</h2><ul>${occurrences.map(o => `<li>${o.occurrence_date} ${o.event_time || ''} — ${o.title}</li>`).join('') || '<li>Nenhum evento esta semana.</li>'}</ul>`
    const recipients = await db.prepare("SELECT * FROM digest_recipients WHERE digest_type = 'weekly'").all()
    for (const r of recipients) {
      if (r.user_id) await createNotification(db, r.user_id, 'agenda', subject, text.slice(0, 200), '/agenda')
      await queueEmail(db, { to_email: r.email, to_user_id: r.user_id, subject, html, text, related_type: 'weekly_digest', related_id: null })
    }
    await setSetting(db, 'last_weekly_digest_sent', localDateStr)
  }

  // Alerta diário (compromissos de amanhã, hora configurável, padrão 22h)
  const dailyEnabled = (await getSetting(db, 'daily_digest_enabled', 'false')) === 'true'
  const dailyHour = parseInt(await getSetting(db, 'daily_digest_hour', '22'), 10)
  const lastDaily = await getSetting(db, 'last_daily_digest_sent', '')
  if (dailyEnabled && localHour === dailyHour && lastDaily !== localDateStr) {
    const tomorrow = new Date(localMs + 86400000).toISOString().slice(0, 10)
    const occurrences = await expandEventsInRange(db, tomorrow, tomorrow)
    const subject = `Compromissos de amanhã (${occurrences.length})`
    const text = occurrences.length
      ? occurrences.map(o => `- ${o.event_time || ''} ${o.title}`).join('\n')
      : 'Nenhum compromisso agendado para amanhã.'
    const html = `<h2>Compromissos de amanhã</h2><ul>${occurrences.map(o => `<li>${o.event_time || ''} — ${o.title}</li>`).join('') || '<li>Nenhum compromisso.</li>'}</ul>`
    const recipients = await db.prepare("SELECT * FROM digest_recipients WHERE digest_type = 'daily'").all()
    for (const r of recipients) {
      if (r.user_id) await createNotification(db, r.user_id, 'agenda', subject, text.slice(0, 200), '/agenda')
      await queueEmail(db, { to_email: r.email, to_user_id: r.user_id, subject, html, text, related_type: 'daily_digest', related_id: null })
    }
    await setSetting(db, 'last_daily_digest_sent', localDateStr)
  }
}
