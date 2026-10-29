// Telão PARISFE: monta as seções, liga a rolagem à pose da logo 3D e cuida do
// modo TV (parada, a página rola sozinha de valor em valor).
import './style.css'
import { createLogoScene } from './logo3d.js'

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
const DWELL_MS = 9000        // modo TV: tempo parado em cada seção
const IDLE_MS = 15000        // modo TV volta a rolar depois de tanto tempo sem ninguém mexer
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
// ?embed=1: aberto dentro do UniFlow (aba Início, iframe) — não segura a tela acesa
const embedded = new URLSearchParams(location.search).has('embed')
const $ = id => document.getElementById(id)
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')

// ── seções dos valores (logo alterna de lado; o texto fica do outro) ──
const outro = $('encerramento')
VALUES.forEach((v, i) => {
  const sec = document.createElement('section')
  sec.className = 'value'
  sec.id = slug(v.name)
  sec.dataset.side = i % 2 === 0 ? 'right' : 'left' // texto à direita = logo à esquerda
  // cada letra anima sozinha, mas agrupada por palavra (senão a linha quebra no meio da palavra)
  let n = 0
  const title = v.name.split(' ').map(word => `<span class="wd">${word.split('').map(c =>
    `<span class="ch${n === 0 ? ' initial' : ''}" style="--i:${n++}">${c}</span>`).join('')}</span>`).join(' ')
  sec.innerHTML = `
    <span class="ghost" aria-hidden="true">${v.name[0]}</span>
    <div class="copy">
      <h2 class="title${v.name.length > 16 ? ' long' : ''}" aria-label="${v.name}">${title}</h2>
      <p class="desc"></p>
      <blockquote class="quote"></blockquote>
    </div>`
  sec.querySelector('.desc').textContent = v.desc
  sec.querySelector('.quote').textContent = `“${v.quote}”`
  outro.before(sec)

  const a = document.createElement('a')
  a.href = `#${sec.id}`
  a.textContent = v.name[0]
  a.title = v.name
  a.setAttribute('aria-label', v.name)
  $('letters').appendChild(a)
})
const sections = [...document.querySelectorAll('main > section')]
const LAST = sections.length - 1

// texto entra quando a seção ocupa a tela (responde à rolagem da pessoa)
const io = new IntersectionObserver(entries => {
  for (const e of entries) e.target.classList.toggle('in', e.isIntersecting)
}, { threshold: 0.45 })
sections.forEach(s => s.classList.contains('value') && io.observe(s))

// ── cena 3D (com plano B em SVG se o aparelho não tiver WebGL) ──
let scene = null
try { scene = createLogoScene($('scene')) } catch (e) {
  console.warn('WebGL indisponível, usando a logo plana:', e)
  $('scene').hidden = true
  $('fallback').hidden = false
}

// Pose da logo em cada seção: abertura/encerramento no centro; nos valores, do lado
// oposto ao texto. Em tela em pé, sempre em cima, centralizada.
function poseFor(k) {
  const view = scene ? scene.viewSize() : { w: 16, h: 9 }
  const portrait = innerWidth / innerHeight < 1
  // em pé, o anel (diâmetro ≈ 5,1 × escala) tem que caber na largura
  const fit = Math.min(0.62, view.w * 0.17)
  if (k === 0 || k === LAST) return { x: 0, y: portrait ? view.h * 0.12 : view.h * 0.09, scale: portrait ? fit * 1.1 : 0.74 }
  if (portrait) return { x: 0, y: view.h * 0.2, scale: fit }
  const textRight = sections[k].dataset.side === 'right'
  return { x: (textRight ? -1 : 1) * view.w * 0.23, y: 0, scale: 0.8 }
}
const lerp = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)
// gira de verdade só no meio da passagem; perto de cada seção a logo fica de frente
const spinEase = f => f < 0.2 ? 0 : f > 0.8 ? 1 : smooth((f - 0.2) / 0.6)

// ── modo TV ──
let auto = true, lastInput = performance.now() - IDLE_MS, dwellStart = performance.now(), tween = null
const scrollTopOf = k => sections[k].offsetTop
const currentIndex = () => Math.min(LAST, Math.max(0, Math.round(scrollY / innerHeight)))

function goTo(k, { instant = false } = {}) {
  k = Math.max(0, Math.min(LAST, k))
  const from = scrollY, to = scrollTopOf(k)
  dwellStart = performance.now()
  if (instant || reduced || Math.abs(to - from) < 2) { scrollTo(0, to); return }
  const dur = Math.min(2600, 900 + Math.abs(to - from) / innerHeight * 700)
  tween = { from, to, start: performance.now(), dur }
  document.documentElement.style.scrollSnapType = 'none'
}
function stepTween(now) {
  if (!tween) return
  const t = Math.min(1, (now - tween.start) / tween.dur)
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  scrollTo(0, lerp(tween.from, tween.to, e))
  if (t >= 1) { tween = null; document.documentElement.style.scrollSnapType = ''; dwellStart = now }
}
function userInput() {
  lastInput = performance.now()
  if (tween) { tween = null; document.documentElement.style.scrollSnapType = '' }
}
for (const ev of ['wheel', 'touchstart', 'pointerdown']) addEventListener(ev, userInput, { passive: true })

function setAuto(on) {
  auto = on
  $('auto').setAttribute('aria-pressed', String(on))
  $('auto').title = on ? 'Pausar a rolagem automática' : 'Rolar sozinho (modo TV)'
  $('auto').setAttribute('aria-label', $('auto').title)
  $('auto').innerHTML = on
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>'
  dwellStart = performance.now()
  if (on) lastInput = performance.now() - IDLE_MS
}
setAuto(true)
$('auto').addEventListener('click', () => { setAuto(!auto); flashHint() })

// letras do topo e "voltar ao início" rolam animado em vez de pular
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]')
  if (!a) return
  const k = sections.findIndex(s => `#${s.id}` === a.getAttribute('href'))
  if (k < 0) return
  e.preventDefault(); userInput(); goTo(k)
})

async function toggleFull() {
  try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen() } catch {}
  keepAwake()
}
$('full').addEventListener('click', toggleFull)
let wakeLock = null
async function keepAwake() {
  if (embedded) return
  try { if (!wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null }) } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake() })

document.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const k = currentIndex()
  if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); userInput(); goTo(k + 1); flashHint() }
  else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); userInput(); goTo(k - 1); flashHint() }
  else if (e.key === 'Home') { e.preventDefault(); userInput(); goTo(0) }
  else if (e.key === 'End') { e.preventDefault(); userInput(); goTo(LAST) }
  else if (e.key === ' ') { e.preventDefault(); setAuto(!auto); flashHint() }
  else if (e.key === 'f' || e.key === 'F') toggleFull()
})
let hintTimer = 0
function flashHint() {
  $('hint').classList.add('on')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => $('hint').classList.remove('on'), 2800)
}

// ── laço de cada quadro ──
let s = scrollY / innerHeight, lastK = -1, lastNow = performance.now()
function frame(now) {
  stepTween(now)
  const target = scrollY / innerHeight
  // a logo segue a rolagem com um leve atraso — por tempo, não por quadro, pra
  // andar igual numa TV lenta e num computador rápido
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now
  s = reduced ? target : lerp(s, target, 1 - Math.exp(-dt * 5.5))
  const k = Math.min(LAST - 1, Math.max(0, Math.floor(s)))
  const f = Math.min(1, Math.max(0, s - k))

  // modo TV: parado e ninguém mexendo há um tempo → próxima seção
  const idle = now - lastInput > IDLE_MS
  const dwellP = Math.min(1, (now - dwellStart) / DWELL_MS)
  if (auto && idle && !tween && dwellP >= 1) goTo(currentIndex() >= LAST ? 0 : currentIndex() + 1)

  if (scene) {
    const a = poseFor(k), b = poseFor(k + 1), e = reduced ? Math.round(f) : spinEase(f)
    const t = now / 1000
    scene.update({
      x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), scale: lerp(a.scale, b.scale, e),
      rotY: (k + e) * Math.PI * 2 + (reduced ? 0 : Math.sin(t * 0.6) * 0.14),
      rotX: -0.1 + Math.sin(f * Math.PI) * 0.32 + (reduced ? 0 : Math.sin(t * 0.45) * 0.05),
      ringTilt: Math.sin(f * Math.PI) * 0.9 + (reduced ? 0 : Math.sin(t * 0.3) * 0.12),
      ringFill: auto && idle && !tween ? dwellP : 1,
      coreOut: Math.sin(f * Math.PI),
      time: t, scroll: s,
    })
  }

  // letra gigante com profundidade: anda mais devagar que o texto
  for (let i = 1; i < LAST; i++) {
    const p = Math.max(-1.5, Math.min(1.5, s - i))
    sections[i].style.setProperty('--p', p.toFixed(3))
  }
  // contador, trilho e letra ativa no topo
  const cur = currentIndex()
  if (cur !== lastK) {
    lastK = cur
    const isValue = cur > 0 && cur < LAST
    $('count').innerHTML = isValue ? `<b>${String(cur).padStart(2, '0')}</b> / ${String(VALUES.length).padStart(2, '0')}` : ''
    ;[...$('letters').children].forEach((el, i) => el.setAttribute('aria-current', String(i + 1 === cur)))
    document.title = isValue ? `${VALUES[cur - 1].name} · PARISFE UniFECAF` : 'PARISFE UniFECAF'
    $('cue').style.opacity = cur === 0 ? '' : '0'
    if (!tween) dwellStart = now
  }
  $('railFill').style.transform = `scaleX(${Math.min(1, s / LAST).toFixed(4)})`
  requestAnimationFrame(frame)
}

// abriu direto num valor (#agilidade): vai pra ele
const startK = sections.findIndex(sec => `#${sec.id}` === location.hash)
if (startK > 0) goTo(startK, { instant: true })
keepAwake()
requestAnimationFrame(frame)
