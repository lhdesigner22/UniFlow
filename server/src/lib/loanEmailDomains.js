// E-mails aceitos no Empréstimo de Equipamentos: só contas de colaboradores e
// professores. Conta de aluno (@a.fecaf.com.br) NÃO vale. Compara o domínio
// INTEIRO (não "termina com"), porque a.fecaf.com.br termina com fecaf.com.br.
// (Mantenha em sincronia com client/src/utils/loanEmail.js.)
export const ALLOWED_LOAN_EMAIL_DOMAINS = ['fecaf.com.br', 'pro.fecaf.com.br', 'colegioser.com']

export const LOAN_EMAIL_ERROR = 'E-mail não permitido. Use apenas @fecaf.com.br, @pro.fecaf.com.br ou @colegioser.com.'

export function isAllowedLoanEmail(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/)
  return !!m && ALLOWED_LOAN_EMAIL_DOMAINS.includes(m[1])
}
