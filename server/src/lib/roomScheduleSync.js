// Sincroniza a grade de salas do unifecaf-horario.netlify.app (visualização
// pública, sem login) pra tabela room_schedule_snapshot. O site é um SPA que
// só renderiza os dados no navegador, então usa o Browser Rendering da
// Cloudflare (binding BROWSER) em vez de um fetch simples. Roda todo domingo
// (cron em worker.js) e sob demanda pelo botão do Super Admin.
//
// A montagem dos INSERTs acontece DENTRO do navegador (page.evaluate): o
// Worker Free tem só 10 ms de CPU por invocação, então ele só repassa as
// strings SQL prontas pro D1. Lê a semana exibida e a seguinte, pra cobrir a
// segunda-feira não importa em que semana o site classifique o domingo.
import puppeteer from '@cloudflare/puppeteer'

const SITE_URL = 'https://unifecaf-horario.netlify.app/'

// Roda no navegador. Devolve { days, statements } com o DELETE do intervalo
// e os INSERTs (40 linhas cada) já escapados.
function extractInPage(todayISO) {
  const buildingKey = title => /^CENTRO\b/.test(title) ? 'centro' : /^G5\b/.test(title) ? 'g5' : /^SEDE\b/.test(title) ? 'sede' : null
  const typeKey = cls => cls.includes('official') ? 'aula_oficial' : cls.includes('pre') ? 'pre_aula'
    : cls.includes('pos') ? 'pos_aula' : cls.includes('semi') ? 'semipresencial' : cls.includes('free') ? 'disponivel' : 'sem_uso'
  const esc = v => (v === null || v === undefined) ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"

  const table = document.querySelector('table')
  const headerRow = Array.from(table.querySelectorAll('tr')).find(r => r.querySelectorAll('th').length > 0)
  const today = new Date(todayISO + 'T12:00:00Z')
  const dayDates = Array.from(headerRow.querySelectorAll('th small')).map(x => {
    const [d, m] = x.textContent.trim().split('/')
    // O cabeçalho só tem dd/mm: escolhe o ano que deixa a data mais perto de hoje (virada de ano).
    const y = [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]
      .sort((a, b) => Math.abs(new Date(`${a}-${m}-${d}T12:00:00Z`) - today) - Math.abs(new Date(`${b}-${m}-${d}T12:00:00Z`) - today))[0]
    return `${y}-${m}-${d}`
  })

  let building = null
  const rows = []
  for (const r of Array.from(table.querySelectorAll('tr'))) {
    if (r.classList.contains('disp-campus-row-title')) { building = buildingKey(r.textContent.trim()); continue }
    const nameCell = r.querySelector('td.disp-sala-name')
    if (!nameCell || !building) continue
    const room = nameCell.querySelector('strong')?.textContent.trim()
    Array.from(r.querySelectorAll('td.disp-week-cell')).forEach((cell, i) => {
      const items = cell.querySelectorAll('.disp-item')
      if (items.length === 0) {
        const slot = cell.querySelector('.disp-slot')
        if (slot) rows.push([building, room, dayDates[i], typeKey(slot.className), null, null])
        return
      }
      items.forEach(it => rows.push([building, room, dayDates[i], typeKey(it.className),
        it.querySelector('.disp-slot-main')?.textContent.trim() || null,
        it.querySelector('.disp-item-prof')?.textContent.trim() || null]))
    })
  }

  const days = [...new Set(dayDates)].sort()
  const statements = [`DELETE FROM room_schedule_snapshot WHERE building IN ('sede','centro','g5') AND day_date BETWEEN '${days[0]}' AND '${days[days.length - 1]}'`]
  for (let i = 0; i < rows.length; i += 40) {
    const values = rows.slice(i, i + 40)
      .map(([b, room, day, type, code, prof]) => `(${esc(crypto.randomUUID())}, ${esc(b)}, ${esc(room)}, ${esc(day)}, ${esc(type)}, ${esc(code)}, ${esc(prof)})`)
      .join(',')
    statements.push(`INSERT INTO room_schedule_snapshot (id, building, room_name, day_date, occupation_type, class_code, professor_name) VALUES ${values}`)
  }
  return { days, count: rows.length, statements }
}

async function clickByText(page, selector, text) {
  const ok = await page.evaluate((sel, txt) => {
    const el = Array.from(document.querySelectorAll(sel)).find(e => e.textContent.includes(txt))
    if (!el) return false
    el.click()
    return true
  }, selector, text)
  if (!ok) throw new Error(`Não achei "${text}" no site de horários (o layout mudou?)`)
}

export async function runRoomScheduleSync(env) {
  const todayISO = new Date().toISOString().slice(0, 10)
  const results = []

  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: 40000 })
    await clickByText(page, 'button', 'Visualizar sem login')
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Gestão e disponibilidade de salas')), { timeout: 15000 })
    await clickByText(page, 'button', 'Gestão e disponibilidade de salas')
    await page.waitForSelector('table tr.disp-campus-row-title', { timeout: 20000 })

    results.push(await page.evaluate(extractInPage, todayISO))

    const firstDay = await page.evaluate(() => document.querySelector('table th small')?.textContent.trim())
    await clickByText(page, 'button', 'Próxima semana')
    await page.waitForFunction(prev => document.querySelector('table th small')?.textContent.trim() !== prev, { timeout: 15000 }, firstDay)
    await page.waitForSelector('table tr.disp-campus-row-title', { timeout: 20000 })
    results.push(await page.evaluate(extractInPage, todayISO))
  } finally {
    await browser.close()
  }

  // Trava de segurança: se a leitura veio vazia/quebrada, não apaga a grade boa.
  const total = results.reduce((n, r) => n + r.count, 0)
  if (results.some(r => r.count < 100)) throw new Error(`Leitura suspeita (${results.map(r => r.count).join(' + ')} linhas) — grade anterior mantida`)

  const statements = results.flatMap(r => r.statements)
  await env.DB.batch(statements.map(sql => env.DB.prepare(sql)))

  return { rows: total, days: results.flatMap(r => r.days) }
}
