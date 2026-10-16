// Permissões por módulo, como vêm de GET /auth/me (user.permissions). A regra de
// verdade é aplicada no servidor (worker.js) — isto só serve pra interface não
// mostrar menus/botões que a pessoa não pode usar.
//
// Sem permissions (ex: modo degradado quando o /auth/me falhou por rede) a
// interface fica permissiva e deixa o servidor decidir.
export function levelOf(user, module) {
  if (!user) return 'none'
  if (user.system_role === 'super_admin') return 'edit'
  if (!user.permissions) return 'edit'
  return user.permissions[module] || 'none'
}

export const canView = (user, module) => levelOf(user, module) !== 'none'
export const canEdit = (user, module) => levelOf(user, module) === 'edit'
