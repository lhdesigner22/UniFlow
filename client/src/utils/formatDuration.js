// O backend grava timestamps via `datetime('now')` do SQLite, que sai como
// "YYYY-MM-DD HH:MM:SS" em UTC mas SEM sufixo de timezone. Sem isso, o
// `new Date(...)` do navegador interpreta a string como horário LOCAL (não
// UTC), o que quebra qualquer cálculo de duração (ex: cronômetro ao vivo)
// por horas erradas — mesma correção já aplicada no servidor
// (server/src/routes/timeEntries.js, `parseDbTimestamp`).
export function parseDbTimestamp(ts) {
  if (!ts) return null
  return new Date(ts.replace(' ', 'T') + 'Z')
}

// Datas "puras" (sem hora), tipo `due_date` de card, vêm como "YYYY-MM-DD".
// `new Date("YYYY-MM-DD")` trata isso como meia-noite UTC — em fuso negativo
// (Brasília, UTC-3) isso exibe o dia ANTERIOR ao real. Parseia os componentes
// direto como data local pra evitar esse shift (mesma correção já usada em
// client/src/pages/AgendaPage.jsx `parseLocalDate`).
export function parseDateOnly(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// "Hoje" em YYYY-MM-DD no fuso LOCAL do navegador. `new Date().toISOString()`
// usa UTC — depois das ~21h em Brasília (UTC-3) isso já viraria o dia
// seguinte. Usado como valor padrão de formulários (ex: lançamento manual de
// tempo).
export function todayLocalISO() {
  const d = new Date()
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// HH:MM ⇄ seconds helpers, used by the manual time-entry form.
export function hhmmToSeconds(hhmm) {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return ((h || 0) * 3600) + ((m || 0) * 60)
}

export function secondsToHHMM(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
