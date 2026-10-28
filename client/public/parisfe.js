// Telão PARISFE (/parisfe) — script separado do HTML porque a CSP do site
// (public/_headers) não aceita script inline.
// Os 7 valores da placa física da UniFECAF (mesmos textos da tela Início do UniFlow).
const VALUES = [
  { name: 'Proatividade', desc: 'Antecipar problemas e agir antes de alguém precisar pedir. Perceber o que está errado e já se mexer.', quote: 'Aproveitando que pediu o boleto: por que faltou às últimas 5 aulas? Você está bem?' },
  { name: 'Agilidade', desc: 'Responder rápido e sem enrolação. O tempo de quem está esperando importa.', quote: 'Não basta fazer, tem que ser AGORA!' },
  { name: 'Resolutividade', desc: 'Ir até o fim: não empurrar o problema adiante nem resolver pela metade.', quote: 'Não basta ser rápido, tem que RESOLVER!' },
  { name: 'Informalidade', desc: 'Tratar as pessoas com leveza e proximidade, sem perder o profissionalismo no meio do caminho.', quote: ';) arrasoooooooooooooou miga!!!' },
  { name: 'Segurança da informação passada', desc: 'Confirmar antes de afirmar. Informação errada passada adiante custa caro pra outra pessoa.', quote: 'Você tem certeza?' },
  { name: 'Flexibilidade', desc: 'Adaptar a regra ao caso real, sem perder o bom senso nem travar no “não pode”.', quote: 'Olha, já que a regra não te atende, isso aqui não funcionaria para você?' },
  { name: 'Empatia', desc: 'Se colocar no lugar de quem está pedindo ajuda antes de responder.', quote: 'Eu te entendo! Vou te ajudar...' },
]
const SLIDE_MS = Number(getComputedStyle(document.documentElement).getPropertyValue('--slide-ms')) || 10000
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = id => document.getElementById(id)
const stage = $('stage'), copy = $('copy'), glow = $('glow'), logo = $('logo')

// navegação pelas letras P-A-R-I-S-F-E
VALUES.forEach((v, i) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = v.name[0]
  b.title = v.name
  b.setAttribute('aria-label', v.name)
  b.addEventListener('click', () => go(i, true))
  $('letters').appendChild(b)
})

let current = -1, paused = false, startedAt = 0, elapsedBeforePause = 0, swapTimer = 0

function wordHTML(i) {
  return VALUES.map((v, k) => k === i ? `<b>${v.name[0]}</b>` : v.name[0]).join('')
}
function titleHTML(name) {
  // cada palavra sobe dentro da própria máscara; a inicial vem no verde da marca
  return name.split(' ').map((w, k) => {
    const inner = k === 0 ? `<span class="initial">${w[0]}</span>${w.slice(1)}` : w
    return `<span class="w"><span>${inner}</span></span>`
  }).join(' ')
}
function render(i) {
  const v = VALUES[i]
  const t = $('title')
  t.innerHTML = titleHTML(v.name)
  t.classList.toggle('long', v.name.length > 16)
  $('desc').textContent = v.desc
  $('quote').textContent = `“${v.quote}”`
  $('word').innerHTML = wordHTML(i)
  $('count').innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> / ${String(VALUES.length).padStart(2, '0')}`
  ;[...$('letters').children].forEach((b, k) => b.setAttribute('aria-current', k === i ? 'true' : 'false'))
  document.title = `${v.name} · PARISFE UniFECAF`
}
function go(i, manual) {
  i = (i + VALUES.length) % VALUES.length
  if (i === current) return
  clearTimeout(swapTimer)
  const first = current < 0
  current = i
  elapsedBeforePause = 0
  startedAt = performance.now()
  if (first || reduced) {
    copy.classList.remove('leaving'); render(i)
    requestAnimationFrame(() => copy.classList.add('show'))
  } else {
    copy.classList.remove('show'); copy.classList.add('leaving')
    swapTimer = setTimeout(() => {
      copy.classList.remove('leaving'); render(i)
      requestAnimationFrame(() => requestAnimationFrame(() => copy.classList.add('show')))
    }, 480)
  }
  logo.classList.add('pulse'); setTimeout(() => logo.classList.remove('pulse'), 700)
  if (manual) flashHint()
}

// o anel enche durante o tempo de cada valor e passa pro próximo
function tick(now) {
  if (current >= 0) {
    const elapsed = paused ? elapsedBeforePause : elapsedBeforePause + (now - startedAt)
    const p = Math.min(1, elapsed / SLIDE_MS)
    glow.style.strokeDashoffset = String(1 - p)
    if (!paused && p >= 1) go(current + 1)
  }
  requestAnimationFrame(tick)
}

function setPaused(on) {
  if (on === paused) return
  if (on) elapsedBeforePause += performance.now() - startedAt
  else startedAt = performance.now()
  paused = on
  $('pause').setAttribute('aria-label', on ? 'Continuar' : 'Pausar')
  $('pause').innerHTML = on
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
}
async function toggleFull() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { /* navegador sem tela cheia: segue na janela */ }
  keepAwake()
}
// TV ligada: pede pra tela não apagar enquanto a página estiver aberta
let wakeLock = null
async function keepAwake() {
  try { if (!wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null }) } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake() })

let hintTimer = 0
function flashHint() {
  $('hint').classList.add('on')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => $('hint').classList.remove('on'), 2600)
}

$('pause').addEventListener('click', () => setPaused(!paused))
$('full').addEventListener('click', toggleFull)
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') go(current + 1, true)
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(current - 1, true)
  else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPaused(!paused); flashHint() }
  else if (e.key === 'f' || e.key === 'F') toggleFull()
})
// toque no celular: deslizar troca o valor
let touchX = null
stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX }, { passive: true })
stage.addEventListener('touchend', e => {
  if (touchX == null) return
  const dx = e.changedTouches[0].clientX - touchX
  if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1), true)
  touchX = null
})

go(0)
keepAwake()
requestAnimationFrame(tick)
