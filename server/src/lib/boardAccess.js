// Resolução de acesso a um quadro, compartilhada por boards.js/columns.js/
// cards.js/metrics.js — antes cada arquivo tinha sua própria cópia da mesma
// checagem (owner/membro); centralizado aqui pra acrescentar a regra nova
// sem duplicar em 4 lugares.
//
// role: 'owner' | 'admin' | 'member' | 'dept_admin' | 'viewer' | null (null = sem acesso)
//
// Super Admin com departamento definido também enxerga os quadros cujo DONO
// for do mesmo departamento que o dele — visão de controle por área, sem
// precisar ser convidado quadro a quadro. Isso vem como 'dept_admin' (não
// 'member' nem 'admin' de verdade) pra cada rota decidir, ação por ação, se
// esse acesso conta como suficiente: hoje isso já cobre ver o quadro,
// interagir com cards e arquivar/desarquivar (equivalente a admin nessas
// ações); renomear e excluir o quadro continuam exigindo 'owner'/'admin' de
// verdade — não usar 'dept_admin' nessas checagens sem decisão explícita.
//
// 'viewer' é o papel do perfil Auditor (system_role='auditor'): enxerga
// TODOS os quadros de TODO MUNDO, sem exceção de departamento — mas nunca
// deve ser tratado como suficiente pra escrever nada (nenhuma rota deveria
// aceitar 'viewer' num `role !== 'owner' && role !== 'admin'`-style check,
// e mesmo que alguma aceitasse por engano, o middleware global em
// worker.js já bloqueia qualquer requisição não-GET desse perfil antes de
// chegar nas rotas — essa é a defesa real, isto aqui é só visibilidade).
export async function resolveBoardRole(db, board, userId) {
  if (!board) return null
  if (board.owner_id === userId) return 'owner'

  const member = await db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(board.id, userId)
  if (member) return member.role

  const requester = await db.prepare('SELECT system_role, department_id FROM users WHERE id = ?').get(userId)
  if (requester?.system_role === 'auditor') return 'viewer'
  if (requester?.system_role === 'super_admin' && requester.department_id) {
    const owner = await db.prepare('SELECT department_id FROM users WHERE id = ?').get(board.owner_id)
    if (owner?.department_id === requester.department_id) return 'dept_admin'
  }
  return null
}

export async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// IDs de todos os quadros visíveis a um usuário — mesma regra acima, mas em
// lote (usado pela listagem de quadros e pelas métricas, evitando N
// resoluções de acesso individuais). Auditor enxerga TODOS os quadros, sem
// exceção — é o ponto principal desse perfil.
export async function getVisibleBoardIds(db, userId) {
  const requester = await db.prepare('SELECT system_role, department_id FROM users WHERE id = ?').get(userId)

  if (requester?.system_role === 'auditor') {
    const rows = await db.prepare('SELECT id FROM boards').all()
    return rows.map(r => r.id)
  }

  const seesDept = requester?.system_role === 'super_admin' && !!requester.department_id

  const rows = await db.prepare(`
    SELECT b.id FROM boards b
    WHERE b.owner_id = ?
      OR b.id IN (SELECT board_id FROM board_members WHERE user_id = ?)
      ${seesDept ? 'OR b.owner_id IN (SELECT id FROM users WHERE department_id = ?)' : ''}
  `).all(...(seesDept ? [userId, userId, requester.department_id] : [userId, userId]))

  return rows.map(r => r.id)
}
