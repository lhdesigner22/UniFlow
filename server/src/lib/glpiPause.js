// Interruptor "pausar consultas ao GLPI" (Admin → GLPI). Criado em out/2026,
// quando o servidor do GLPI caiu: com ele ligado, o UniFlow NÃO fala com o GLPI
// — nem os crons (Backlog, filas/importação, Eventos, cache de técnicos, Total)
// nem os botões (Atualizar agora, sincronizar, solucionar duplicatas, buscar
// entidades). As telas continuam mostrando o último resumo salvo.
// app_settings.glpi_paused = JSON { paused, at, by }.
export async function glpiPauseState(db) {
  const raw = await db.scalar("SELECT value FROM app_settings WHERE key = 'glpi_paused'")
  try {
    const s = JSON.parse(raw || '{}')
    return { paused: s.paused === true, at: s.at || null, by: s.by || null }
  } catch {
    return { paused: false, at: null, by: null }
  }
}

export const isGlpiPaused = async db => (await glpiPauseState(db)).paused

export async function setGlpiPaused(db, paused, by) {
  const value = JSON.stringify({ paused: !!paused, at: new Date().toISOString(), by: by || null })
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('glpi_paused', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value)
  return JSON.parse(value)
}

export const PAUSED_MESSAGE = 'As consultas ao GLPI estão pausadas (Admin → GLPI). Religue lá quando o GLPI estiver normal.'
