// Liga cada <label> ao campo que vem logo depois dele.
//
// Os formulários do app são escritos assim:
//   <div><label className="label">Título</label><input ... /></div>
// O rótulo aparece na tela, mas sem `htmlFor` o leitor de tela anuncia o campo
// só como "caixa de edição" e clicar no rótulo não foca o campo (WCAG 1.3.1 /
// 3.3.2 — auditoria de acessibilidade de out/2026: 163 rótulos soltos). Em vez
// de mexer em cada formulário, este observador faz a ligação sozinho, inclusive
// nos modais que abrem depois: dá um id ao campo (se não tiver) e põe o `for`
// no rótulo. Rótulo que já tem `for` ou que envolve o campo fica como está.
const CONTROL = 'input:not([type="hidden"]), select, textarea'
let seq = 0

function controlAfter(label) {
  for (let el = label.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.tagName === 'LABEL') return null // o próximo rótulo já é de outro campo
    if (el.matches(CONTROL)) return el
    const inner = el.querySelector(CONTROL)
    if (inner) return inner
  }
  return null
}

function linkLabels() {
  for (const label of document.querySelectorAll('label:not([for])')) {
    if (label.querySelector(CONTROL)) continue
    const control = controlAfter(label)
    if (!control || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) continue
    if (control.labels?.length) continue
    if (!control.id) control.id = `campo-${++seq}`
    label.htmlFor = control.id
  }
}

export function startAutoLabel() {
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; linkLabels() })
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  schedule()
}
