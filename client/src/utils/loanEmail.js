// E-mails aceitos no Empréstimo de Equipamentos: só contas de colaboradores e
// professores. Conta de aluno (@a.fecaf.com.br) NÃO vale. Compara o domínio
// INTEIRO, porque a.fecaf.com.br "termina com" fecaf.com.br.
// (Mantenha em sincronia com server/src/lib/loanEmailDomains.js.)
export const LOAN_EMAIL_ERROR = 'Use apenas e-mail @fecaf.com.br, @pro.fecaf.com.br ou @colegioser.com.'

const ALLOWED = ['fecaf.com.br', 'pro.fecaf.com.br', 'colegioser.com']

export function isAllowedLoanEmail(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/)
  return !!m && ALLOWED.includes(m[1])
}
