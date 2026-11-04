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

// Cargo "só o Portal do Professor": vê o módulo teacher e nenhum outro. Esse
// usuário não usa o layout com menu (nem tempo real/sininho) — vai direto para
// /professor. Super Admin nunca cai aqui (ele vê tudo).
export function isTeacherOnly(user) {
  if (!user?.permissions || user.system_role !== 'user') return false
  const p = user.permissions
  return p.teacher && p.teacher !== 'none' && Object.entries(p).every(([k, v]) => k === 'teacher' || v === 'none')
}
