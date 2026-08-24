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
