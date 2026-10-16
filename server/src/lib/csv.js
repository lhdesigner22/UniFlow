// Célula de CSV para as exportações (Tempo, Compras, Empréstimos).
// Texto que começa com = + - @ (ou tab/CR) o Excel executa como fórmula —
// "CSV injection": alguém grava "=HYPERLINK(...)" num campo e quem abrir a
// planilha exportada é enganado. Prefixar com ' faz o Excel tratar como texto.
// Números passam direto (preço negativo continua número).
export function escapeCsv(v) {
  if (typeof v === 'number') return String(v)
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
