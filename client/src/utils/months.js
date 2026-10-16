// Helpers de "mês de referência" (formato YYYY-MM) — usados tanto na
// Sidebar (cascata de meses de Solicitação de Compra) quanto na própria
// PurchaseRequestsPage (título, criação de item, filtro por mês).

export function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

// "2026-09" -> "Setembro de 2026"
export function monthLabel(ym) {
  if (!ym) return ''
  const [year, month] = ym.split('-').map(Number)
  const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Janela de meses (-6 a +12 a partir de hoje) + qualquer mês extra
// informado (ex: meses que já têm solicitação fora dessa janela) — dá pra
// ir criando/selecionando os meses seguintes conforme for precisando.
export function buildMonthOptions(existingMonths = []) {
  const set = new Set(existingMonths.filter(Boolean))
  const now = new Date()
  for (let i = -6; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return [...set].sort().map(ym => ({ key: ym, label: monthLabel(ym) }))
}
