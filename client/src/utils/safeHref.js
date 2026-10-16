// Link digitado por alguém → <a href> seguro. Um "javascript:..." gravado
// (antes de o servidor validar, ou por outra via) viraria XSS ao clicar e
// poderia roubar a sessão. Esquemas que executam código viram undefined (o
// link fica inerte); o resto passa como está. O navegador ignora espaços e
// caracteres de controle antes do esquema, então eles são tirados antes de olhar.
// (Mantenha em sincronia com server/src/lib/safeUrl.js.)
export function safeHref(url) {
  if (!url) return undefined
  const s = String(url).replace(/[\u0000- ]/g, '').toLowerCase()
  if (/^(javascript|data|vbscript|blob|file):/.test(s)) return undefined
  return url
}
