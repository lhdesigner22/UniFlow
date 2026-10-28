// Cases de Sucesso → apresentação para baixar em PPTX (pptxgenjs) e PDF (pdf-lib),
// montada no navegador como as planilhas (o Worker não aguentaria gerar arquivo).
// As bibliotecas vêm por import dinâmico: não pesam no app nem entram no
// pré-cache do PWA (vite.config.js → globIgnores).
//
// Um só layout em polegadas (16:9 "wide", 13,333 × 7,5) desenhado pelos dois
// formatos — no PDF 1 polegada = 72 pt —, então PPTX e PDF saem iguais.
// Regras da skill pptx: Arial (fonte segura), sem faixas/linhas decorativas,
// corpo ≥ 12 pt (texto longo é cortado com "…" em vez de estourar a caixa).
//
// `model` vem pronto da tela (SuccessCasesPage): { year, kpis, pillars, slides }.

const W = 13.333, H = 7.5, M = 0.8
const C = {
  bg: '111318', card: '1A1D24', line: '2A2F3A', text: 'F5F7FA', muted: '9BA3B0',
  brand: '3B82F6', save: '22C55E',
}
const FONT = 'Arial'

// ── Medida de texto (mesma regra de quebra nos dois formatos) ─────────────
// Larguras do Arial/Helvetica (métricas AFM, em milésimos do corpo).
let measureCtx = null
function textWidthIn(text, sizePt, bold) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx.font = `${bold ? 'bold ' : ''}${sizePt}px Arial, Helvetica, sans-serif`
  // px no tamanho N ≈ pt → polegadas; +4% de folga pro PowerPoint não quebrar a linha de novo
  return measureCtx.measureText(text).width * 1.04 / 72
}

// Quebra em linhas que cabem em `widthIn`; se passar de `maxLines`, corta com "…"
function wrap(text, sizePt, widthIn, maxLines, bold = false) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (textWidthIn(next, sizePt, bold) <= widthIn || !cur) cur = next
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last && textWidthIn(`${last}…`, sizePt, bold) > widthIn) last = last.replace(/\s*\S+$/, '')
  kept[maxLines - 1] = `${last}…`
  return kept
}

// Maior fonte (entre as opções) em que o texto cabe na caixa sem cortar
function fitText(text, widthIn, heightIn, sizes, lineGap = 1.25, bold = false) {
  for (const size of sizes) {
    const maxLines = Math.max(1, Math.floor(heightIn / (size * lineGap / 72)))
    const all = wrap(text, size, widthIn, 999, bold)
    if (all.length <= maxLines) return { size, lines: all }
  }
  const size = sizes[sizes.length - 1]
  const maxLines = Math.max(1, Math.floor(heightIn / (size * lineGap / 72)))
  return { size, lines: wrap(text, size, widthIn, maxLines, bold) }
}

// ── Fotos: tudo vira JPEG (pdf-lib não lê WEBP) e guarda o tamanho ────────
async function normalizePhoto(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1A1D24'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  return { data: canvas.toDataURL('image/jpeg', 0.88), w: img.naturalWidth, h: img.naturalHeight }
}

// Encaixa (w×h) dentro da caixa mantendo a proporção, centralizado
function contain(photo, box) {
  const scale = Math.min(box.w / photo.w, box.h / photo.h)
  const w = photo.w * scale, h = photo.h * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

// ── Layout comum: lista de "peças" (rect, text, image) em polegadas ───────
// text: { x, y, w, lines, size, color, bold, align, lineGap }
function coverParts(model) {
  const parts = []
  parts.push({ t: 'text', x: M, y: 1.05, w: W - 2 * M, lines: ['TECNOLOGIA DA INFORMAÇÃO · UNIFECAF'], size: 13, color: C.brand, bold: true, spacing: 2 })
  parts.push({ t: 'text', x: M, y: 1.45, w: W - 2 * M, lines: [`Cases de Sucesso ${model.year}`], size: 54, color: C.text, bold: true })
  parts.push({ t: 'text', x: M, y: 2.55, w: 9, lines: wrap('O que a TI entregou para alunos, professores e a operação da instituição', 20, 9, 2), size: 20, color: C.muted })

  const kpis = model.kpis
  const colW = (W - 2 * M) / Math.max(kpis.length, 1)
  kpis.forEach((k, i) => {
    const x = M + i * colW
    const valueSize = k.value.length > 9 ? 34 : 44
    parts.push({ t: 'text', x, y: 3.85, w: colW - 0.2, lines: [k.value], size: valueSize, color: k.accent ? C.save : C.text, bold: true })
    parts.push({ t: 'text', x, y: 4.75, w: colW - 0.3, lines: wrap(k.label, 14, colW - 0.3, 2), size: 14, color: C.muted })
  })

  let x = M
  for (const p of model.pillars) {
    const label = `${p.label} · ${p.count}`
    const w = textWidthIn(label, 13, false) + 0.5
    parts.push({ t: 'pill', x, y: 5.75, w, h: 0.42, fill: C.card, line: C.line, dot: p.color, label, size: 13, color: C.text })
    x += w + 0.16
  }
  parts.push({ t: 'text', x: M, y: H - 0.55, w: 8, lines: [`Gerado pelo UniFlow em ${model.generatedAt}`], size: 11, color: C.muted })
  return parts
}

function caseParts(slide, index, total, model) {
  const parts = []
  // Linha do topo: pilar · situação · mês · save
  let x = M
  parts.push({ t: 'dotText', x, y: 0.55, dot: slide.pillarColor, lines: [slide.pillarLabel], size: 14, color: slide.pillarColor, bold: true })
  x += textWidthIn(slide.pillarLabel, 14, true) + 0.55
  const stW = textWidthIn(slide.status.label, 12, true) + 0.4
  parts.push({ t: 'pill', x, y: 0.5, w: stW, h: 0.36, fill: slide.status.bg, label: slide.status.label, size: 12, color: slide.status.color, bold: true })
  x += stW + 0.18
  if (slide.month) {
    parts.push({ t: 'text', x, y: 0.55, w: 2, lines: [slide.month], size: 13, color: C.muted })
    x += textWidthIn(slide.month, 13, false) + 0.3
  }
  if (slide.save) {
    const sw = textWidthIn(slide.save, 12, true) + 0.4
    parts.push({ t: 'pill', x, y: 0.5, w: sw, h: 0.36, fill: '153322', label: slide.save, size: 12, color: '4ADE80', bold: true })
  }

  const title = fitText(slide.title, W - 2 * M, 1.0, [36, 32, 28], 1.12, true)
  parts.push({ t: 'text', x: M, y: 1.1, w: W - 2 * M, lines: title.lines, size: title.size, color: C.text, bold: true, lineGap: 1.12 })
  const titleBottom = 1.1 + title.lines.length * title.size * 1.12 / 72
  let y = titleBottom + 0.12
  if (slide.headline) {
    const hl = wrap(slide.headline, 17, W - 2 * M, 1)
    parts.push({ t: 'text', x: M, y, w: W - 2 * M, lines: hl, size: 17, color: C.muted })
    y += 0.42
  }

  // Três cartões: Antes → O que fizemos → Resultado
  const hasPhotos = slide.photos.length > 0
  const top = Math.max(y + 0.25, 2.55)
  const cardH = (hasPhotos ? 4.95 : 6.65) - top
  const gap = 0.24
  const cardW = (W - 2 * M - 2 * gap) / 3
  const pad = 0.28
  const blocks = [
    { label: 'ANTES', body: slide.before },
    { label: 'O QUE FIZEMOS', body: slide.solution },
    { label: slide.result.live ? 'RESULTADO · AO VIVO' : 'RESULTADO', result: slide.result },
  ]
  // "Antes" e "O que fizemos" no mesmo tamanho de letra (o menor que cabe nos dois)
  const textBodyH = cardH - pad - 0.38 - pad
  const SIZES = [20, 18, 16, 14, 13, 12]
  const shared = Math.min(...blocks.filter(b => !b.result).map(b => fitText(b.body || '—', cardW - 2 * pad, textBodyH, SIZES).size))
  const sharedSizes = SIZES.filter(sz => sz <= shared)
  blocks.forEach((b, i) => {
    const cx = M + i * (cardW + gap)
    const isResult = !!b.result
    parts.push({ t: 'rect', x: cx, y: top, w: cardW, h: cardH, fill: isResult ? '14261C' : C.card, line: isResult ? '1F4D31' : C.line, radius: 0.12 })
    parts.push({ t: 'text', x: cx + pad, y: top + pad, w: cardW - 2 * pad, lines: [b.label], size: 11, color: isResult ? '4ADE80' : C.muted, bold: true, spacing: 1.5 })
    const bodyY = top + pad + 0.38
    if (!isResult) {
      // Texto curto ganha fonte maior (não sobra cartão vazio); longo desce até 12
      const f = fitText(b.body || '—', cardW - 2 * pad, textBodyH, sharedSizes)
      parts.push({ t: 'text', x: cx + pad, y: bodyY, w: cardW - 2 * pad, lines: f.lines, size: f.size, color: C.text })
    } else {
      let ry = bodyY
      if (b.result.value) {
        const vs = b.result.value.length > 8 ? 34 : 44
        parts.push({ t: 'text', x: cx + pad, y: ry, w: cardW - 2 * pad, lines: [b.result.value], size: vs, color: '4ADE80', bold: true })
        ry += vs * 1.15 / 72 + 0.1
      }
      const rest = [b.result.label, b.result.sentence].filter(Boolean).join('. ')
      if (rest) {
        const f = fitText(rest, cardW - 2 * pad, top + cardH - pad - ry, [20, 18, 16, 14, 13, 12])
        parts.push({ t: 'text', x: cx + pad, y: ry, w: cardW - 2 * pad, lines: f.lines, size: f.size, color: C.text })
      }
    }
  })

  // Fotos (até 4) numa faixa abaixo dos cartões, molduras 16:10 alinhadas à esquerda
  if (hasPhotos) {
    const n = Math.min(slide.photos.length, 4)
    const ph = 1.55
    const pw = Math.min(ph * 1.6, (W - 2 * M - (n - 1) * gap) / n)
    slide.photos.slice(0, n).forEach((p, i) => {
      const box = { x: M + i * (pw + gap), y: 5.15, w: pw, h: ph }
      parts.push({ t: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: C.card, line: C.line, radius: 0.08 })
      parts.push({ t: 'image', ...contain(p, { x: box.x + 0.05, y: box.y + 0.05, w: box.w - 0.1, h: box.h - 0.1 }), photo: p })
    })
  }

  parts.push({ t: 'text', x: M, y: H - 0.55, w: 8, lines: [`Cases de Sucesso ${model.year} · TI UniFECAF`], size: 11, color: C.muted })
  parts.push({ t: 'text', x: W - M - 2, y: H - 0.55, w: 2, lines: [`${index} / ${total}`], size: 11, color: C.muted, align: 'right' })
  return parts
}

function allPages(model) {
  const total = model.slides.length
  return [
    { parts: coverParts(model), notes: '' },
    ...model.slides.map((s, i) => ({ parts: caseParts(s, i + 1, total, model), notes: s.notes || '' })),
  ]
}

async function withPhotos(model) {
  const slides = []
  for (const s of model.slides) {
    const photos = []
    for (const src of s.photos || []) {
      try { photos.push(await normalizePhoto(src)) } catch { /* foto quebrada: pula */ }
    }
    slides.push({ ...s, photos })
  }
  return { ...model, slides }
}

const fileBase = model => `Cases de Sucesso ${model.year} - TI UniFECAF`

// ── PPTX ───────────────────────────────────────────────────────────────────
export async function exportCasesPptx(rawModel) {
  const model = await withPhotos(rawModel)
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_WIDE'
  pres.title = `Cases de Sucesso ${model.year}`
  pres.author = 'TI UniFECAF'
  pres.company = 'UniFECAF'
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT }
  pres.defineSlideMaster({ title: 'UNIFLOW_CASE', background: { color: C.bg } })

  for (const page of allPages(model)) {
    const slide = pres.addSlide({ masterName: 'UNIFLOW_CASE' })
    for (const p of page.parts) drawPptx(pres, slide, p)
    if (page.notes) slide.addNotes(page.notes)
  }
  await pres.writeFile({ fileName: `${fileBase(model)}.pptx` })
}

function drawPptx(pres, slide, p) {
  if (p.t === 'rect') {
    slide.addShape(pres.ShapeType.roundRect, { x: p.x, y: p.y, w: p.w, h: p.h, rectRadius: p.radius || 0.1, fill: { color: p.fill }, line: { color: p.line || p.fill, width: 0.75 } })
  } else if (p.t === 'pill') {
    slide.addShape(pres.ShapeType.roundRect, { x: p.x, y: p.y, w: p.w, h: p.h, rectRadius: p.h / 2, fill: { color: p.fill }, line: { color: p.line || p.fill, width: 0.75 } })
    const tx = p.dot ? p.x + 0.32 : p.x
    if (p.dot) slide.addShape(pres.ShapeType.ellipse, { x: p.x + 0.17, y: p.y + p.h / 2 - 0.05, w: 0.1, h: 0.1, fill: { color: p.dot }, line: { color: p.dot, width: 0 } })
    slide.addText(p.label, { x: tx, y: p.y, w: p.w - (tx - p.x), h: p.h, margin: 0, align: p.dot ? 'left' : 'center', valign: 'middle', fontFace: FONT, fontSize: p.size, bold: !!p.bold, color: p.color, isTextBox: true })
  } else if (p.t === 'dotText') {
    slide.addShape(pres.ShapeType.ellipse, { x: p.x, y: p.y + 0.06, w: 0.13, h: 0.13, fill: { color: p.dot }, line: { color: p.dot, width: 0 } })
    slide.addText(p.lines.join(' '), { x: p.x + 0.25, y: p.y - 0.04, w: 4, h: 0.32, margin: 0, valign: 'middle', fontFace: FONT, fontSize: p.size, bold: !!p.bold, color: p.color, isTextBox: true })
  } else if (p.t === 'text') {
    const gap = p.lineGap || 1.25
    const h = Math.max(p.lines.length * p.size * gap / 72, p.size * 1.3 / 72)
    slide.addText(p.lines.join('\n'), {
      x: p.x, y: p.y, w: p.w, h, margin: 0, valign: 'top', align: p.align || 'left',
      fontFace: FONT, fontSize: p.size, bold: !!p.bold, color: p.color, isTextBox: true,
      lineSpacing: p.size * gap, charSpacing: p.spacing || 0, fit: 'none',
    })
  } else if (p.t === 'image') {
    slide.addImage({ data: p.photo.data, x: p.x, y: p.y, w: p.w, h: p.h })
  }
}

// ── PDF ────────────────────────────────────────────────────────────────────
export async function exportCasesPdf(rawModel) {
  const model = await withPhotos(rawModel)
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(`Cases de Sucesso ${model.year}`)
  doc.setAuthor('TI UniFECAF')
  doc.setCreator('UniFlow')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const color = hex => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
  const imgCache = new Map()

  // A fonte padrão do PDF só tem os caracteres do Latin-1/WinAnsi: o resto é trocado
  const okChar = new Map()
  const clean = (font, s) => [...String(s)].map(ch => {
    const swap = { '→': '>', '←': '<', '−': '-', '✓': 'v', ' ': ' ' }[ch]
    if (swap) return swap
    if (!okChar.has(ch)) { try { font.encodeText(ch); okChar.set(ch, true) } catch { okChar.set(ch, false) } }
    return okChar.get(ch) ? ch : ''
  }).join('')

  for (const pageDef of allPages(model)) {
    const page = doc.addPage([W * 72, H * 72])
    page.drawRectangle({ x: 0, y: 0, width: W * 72, height: H * 72, color: color(C.bg) })
    const Y = (yIn, hIn = 0) => (H - yIn - hIn) * 72 // topo em polegadas → base do PDF em pt
    for (const p of pageDef.parts) {
      if (p.t === 'rect' || p.t === 'pill') {
        const r = p.t === 'pill' ? p.h / 2 : (p.radius || 0.1)
        page.drawSvgPath(roundRectPath(p.w * 72, p.h * 72, r * 72), {
          x: p.x * 72, y: Y(p.y), color: color(p.fill),
          borderColor: color(p.line || p.fill), borderWidth: p.line ? 0.75 : 0,
        })
        if (p.t === 'pill') {
          const font = p.bold ? bold : regular
          const label = clean(font, p.label)
          const tw = font.widthOfTextAtSize(label, p.size)
          let tx = p.x * 72 + (p.w * 72 - tw) / 2
          if (p.dot) {
            page.drawCircle({ x: (p.x + 0.22) * 72, y: Y(p.y + p.h / 2), size: 0.05 * 72, color: color(p.dot) })
            tx = (p.x + 0.32) * 72
          }
          page.drawText(label, { x: tx, y: Y(p.y + p.h / 2) - p.size * 0.35, size: p.size, font, color: color(p.color) })
        }
      } else if (p.t === 'dotText') {
        page.drawCircle({ x: (p.x + 0.065) * 72, y: Y(p.y + 0.125), size: 0.065 * 72, color: color(p.dot) })
        page.drawText(clean(bold, p.lines[0]), { x: (p.x + 0.25) * 72, y: Y(p.y + 0.125) - p.size * 0.35, size: p.size, font: p.bold ? bold : regular, color: color(p.color) })
      } else if (p.t === 'text') {
        const font = p.bold ? bold : regular
        const gap = p.lineGap || 1.25
        p.lines.forEach((line, i) => {
          const txt = clean(font, line)
          const lineTop = p.y + i * p.size * gap / 72
          let x = p.x * 72
          if (p.align === 'right') x = (p.x + p.w) * 72 - font.widthOfTextAtSize(txt, p.size)
          page.drawText(txt, { x, y: Y(lineTop) - p.size * 0.85, size: p.size, font, color: color(p.color), characterSpacing: p.spacing || 0 })
        })
      } else if (p.t === 'image') {
        let img = imgCache.get(p.photo.data)
        if (!img) { img = await doc.embedJpg(p.photo.data); imgCache.set(p.photo.data, img) }
        page.drawImage(img, { x: p.x * 72, y: Y(p.y, p.h), width: p.w * 72, height: p.h * 72 })
      }
    }
  }
  const bytes = await doc.save()
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${fileBase(model)}.pdf`)
}

// Retângulo arredondado como caminho SVG (origem no canto de cima, y para baixo)
function roundRectPath(w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
