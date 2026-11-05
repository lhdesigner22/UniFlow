// Excel da Escala (Time → Escala) com a mesma cara da tela: quadro pessoa × dia,
// cada local com a sua cor, fim de semana sombreado, total por dia e legenda.
// Montado no navegador com ExcelJS (import dinâmico, fora do pré-cache do PWA).

const NAVY = 'FF061826'
const BRAND = 'FF0F6AA8'
const BRAND_DEEP = 'FF0B4F7E'
const MUTED = 'FF5B7186'
const BORDER = 'FFD9E3EC'
const WEEKEND = 'FFF1F5F9'
const WHITE = 'FFFFFFFF'

// mesmas cores da tela (versão clara)
const COLORS = {
  SEDE: { fill: 'FFDBEAFE', font: 'FF0B5689' },
  CENTRO: { fill: 'FFD7F5E4', font: 'FF127A44' },
  G5: { fill: 'FFEDE9FE', font: 'FF5B21B6' },
  G5_SEDE: { fill: 'FFE4E1FB', font: 'FF3F2A9E' },
  ADM: { fill: 'FFE2E8F0', font: 'FF1E293B' },
  FOLGA: { fill: WHITE, font: 'FF64748B' },
  FERIAS: { fill: 'FFFEF3C7', font: 'FF92400E' },
}
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const thin = { style: 'thin', color: { argb: BORDER } }
const box = { top: thin, left: thin, bottom: thin, right: thin }
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

// statuses: [{ key, label, short }]; people: [{ id, name, role_title, hours }];
// days: [{ iso, n, dow, weekend }]; cells: Map "pid|dia" → status; working: lista de status que contam como trabalhando
export async function downloadShiftXlsx({ monthLabel, statuses, people, days, cells, working, author }) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = author ? `UniFlow — ${author}` : 'UniFlow'
  wb.created = new Date()
  const title = `Escala de trabalho — ${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}`
  const ws = wb.addWorksheet('Escala', {
    properties: { tabColor: { argb: BRAND } },
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:5',
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8UniFlow — ${title.replace(/&/g, '&&')}&R&8Página &P de &N` },
  })
  const STATUS = Object.fromEntries(statuses.map(x => [x.key, x]))
  const firstDay = 4
  const lastCol = firstDay + days.length - 1
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 30 }, ...days.map(() => ({ width: 6 }))]

  // título
  ws.mergeCells(1, 1, 1, lastCol)
  Object.assign(ws.getCell(1, 1), { value: title, font: { name: 'Calibri', size: 18, bold: true, color: { argb: NAVY } } })
  ws.getRow(1).height = 30
  ws.mergeCells(2, 1, 2, lastCol)
  const when = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  Object.assign(ws.getCell(2, 1), { value: `Gerado pelo UniFlow em ${when}${author ? ` por ${author}` : ''}`, font: { name: 'Calibri', size: 10, italic: true, color: { argb: MUTED } } })

  // cabeçalho em 2 linhas: dia da semana + número
  const head = (r, c, value, opts = {}) => {
    const cell = ws.getCell(r, c)
    cell.value = value
    cell.font = { name: 'Calibri', size: opts.size || 10, bold: true, color: { argb: WHITE } }
    cell.fill = fill(opts.bg || BRAND)
    cell.alignment = { vertical: 'middle', horizontal: opts.left ? 'left' : 'center', indent: opts.left ? 1 : 0 }
    cell.border = box
  }
  ;[['Colaborador', 1], ['Função', 2], ['Horário', 3]].forEach(([t, c]) => { ws.mergeCells(4, c, 5, c); head(4, c, t, { left: true }) })
  days.forEach((d, i) => {
    const bg = d.weekend ? BRAND_DEEP : BRAND
    head(4, firstDay + i, DOW[d.dow], { bg, size: 9 })
    head(5, firstDay + i, d.n, { bg, size: 11 })
  })
  ws.getRow(4).height = 18
  ws.getRow(5).height = 20

  // pessoas
  let r = 6
  for (const p of people) {
    const row = ws.getRow(r)
    row.height = 30
    const info = [[1, p.name, { bold: true, color: NAVY }], [2, p.role_title || '', { color: MUTED }], [3, p.hours || '', { color: NAVY }]]
    for (const [c, v, f] of info) {
      const cell = ws.getCell(r, c)
      cell.value = v
      cell.font = { name: 'Calibri', size: 10, bold: !!f.bold, color: { argb: f.color } }
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: c === 3, indent: 1 }
      cell.border = box
    }
    days.forEach((d, i) => {
      const cell = ws.getCell(r, firstDay + i)
      const st = cells.get(`${p.id}|${d.iso}`)
      const col = st && COLORS[st]
      cell.value = st ? STATUS[st]?.short || st : ''
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: col?.font || MUTED } }
      cell.fill = fill(col && st !== 'FOLGA' ? col.fill : d.weekend ? WEEKEND : WHITE)
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = box
    })
    r++
  }

  // total de quem trabalha em cada dia
  const tot = ws.getRow(r)
  tot.height = 22
  ws.mergeCells(r, 1, r, 3)
  Object.assign(ws.getCell(r, 1), {
    value: 'Trabalhando no dia', font: { name: 'Calibri', size: 10, bold: true, color: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'right', indent: 1 }, fill: fill('FFE8F0F7'), border: box,
  })
  days.forEach((d, i) => {
    const n = people.reduce((k, p) => k + (working.includes(cells.get(`${p.id}|${d.iso}`)) ? 1 : 0), 0)
    Object.assign(ws.getCell(r, firstDay + i), {
      value: n || null, font: { name: 'Calibri', size: 10, bold: true, color: { argb: NAVY } },
      alignment: { vertical: 'middle', horizontal: 'center' }, fill: fill('FFE8F0F7'), border: box,
    })
  })

  // legenda
  r += 2
  Object.assign(ws.getCell(r, 1), { value: 'Legenda', font: { name: 'Calibri', size: 10, bold: true, color: { argb: NAVY } } })
  // na mesma linha, sob os dias: [amostra] nome (3 colunas) — quebra se não couber
  const legend = statuses.map(x => [x.short, x.label, COLORS[x.key]])
  let c = firstDay
  legend.forEach(([short, label, col]) => {
    if (c + 3 > lastCol) { r++; c = firstDay }
    const sample = ws.getCell(r, c)
    sample.value = short
    sample.font = { name: 'Calibri', size: 9, bold: true, color: { argb: col.font } }
    sample.fill = fill(col.fill)
    sample.alignment = { horizontal: 'center', vertical: 'middle' }
    sample.border = box
    ws.mergeCells(r, c + 1, r, c + 3)
    Object.assign(ws.getCell(r, c + 1), { value: label, font: { name: 'Calibri', size: 10, color: { argb: NAVY } }, alignment: { vertical: 'middle', indent: 1 } })
    c += 4
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Escala ${monthLabel}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
