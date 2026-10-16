// Links digitados pelas pessoas (Base de Conhecimento, Gestão, Impressoras,
// Compras, Cofre) viram <a href> na tela. Sem validação, um link
// "javascript:..." vira XSS: roda no navegador de quem clicar e pode roubar a
// sessão (o token fica no localStorage). Aqui só passam http(s) e mailto.
// Sem esquema ("www.site.com") ganha "https://"; caminho de rede do Windows
// (\\servidor\pasta) fica como está — não executa nada.
// (Mantenha em sincronia com client/src/utils/safeHref.js.)
const ALLOWED = ['http:', 'https:', 'mailto:']

export const LINK_ERROR = 'Link inválido — use um endereço começando com http:// ou https://.'

// undefined → undefined (campo não enviado: o PUT mantém o valor antigo);
// vazio → null; válido → string normalizada; inválido → { error }.
export function normalizeLink(value) {
  if (value === undefined) return undefined
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.startsWith('\\\\')) return s
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    if (ALLOWED.includes(new URL(withScheme).protocol)) return withScheme
  } catch { /* não é URL */ }
  return { error: LINK_ERROR }
}

export const isLinkError = v => !!v && typeof v === 'object' && 'error' in v

// Versão branda pro Cofre, onde o "link" pode ser IP, ssh://, rdp://...: guarda
// como veio, só barra os esquemas que executam código no navegador. O navegador
// ignora espaços/caracteres de controle antes do esquema, então tira antes de olhar.
export function isScriptLink(value) {
  const s = String(value ?? '').replace(/[\u0000- ]/g, '').toLowerCase()
  return /^(javascript|data|vbscript|blob|file):/.test(s)
}
