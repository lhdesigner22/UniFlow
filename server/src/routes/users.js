import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// GET /departments — id, nome e cor dos departamentos. Qualquer pessoa logada:
// os formulários mostram o departamento do conteúdo e quem enxerga todos
// escolhe em qual deles criar.
app.get('/departments', async c => {
  const db = c.get('db')
  return c.json(await db.prepare('SELECT id, name, color FROM departments ORDER BY name').all())
})

// Busca usuários para adicionar em pipes
// super_admin → vê todos  |  outros → vê apenas o seu departamento
//
// NÃO exclui o próprio requisitante — a pessoa pode legitimamente querer se
// adicionar como membro de um card/quadro (ex: um Super Admin se atribuindo
// a uma tarefa de um quadro que ele só enxerga por visão de departamento,
// sem ser membro ainda). O front-end (MemberPicker) já desabilita quem já é
// membro via `existingIds`, então não precisa filtrar isso aqui também.
app.get('/search', async c => {
  const db = c.get('db')
  const q = (c.req.query('q') || '').trim()
  const exclude = c.req.query('exclude')  // exclude = IDs já membros (separados por vírgula)
  const excluded = exclude ? exclude.split(',').filter(Boolean) : []
  const placeholders = excluded.length ? excluded.map(() => '?').join(',') : "''"

  const requester = await db.prepare(
    'SELECT system_role, department_id FROM users WHERE id = ?'
  ).get(c.get('user').id)

  // Sem termo (ou menos de 2 letras): não filtra por nome/email — assim o
  // picker consegue mostrar sugestões (quem ainda não foi incluído) antes
  // mesmo da pessoa digitar algo.
  const searchClause = q.length >= 2 ? '(u.name LIKE ? OR u.email LIKE ?)' : '1=1'
  const searchArgs = q.length >= 2 ? [`%${q}%`, `%${q}%`] : []

  let users
  if (requester.system_role === 'super_admin') {
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${searchClause}
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(...searchArgs, ...excluded)
  } else if (requester.department_id) {
    // Filtrado ao departamento do solicitante
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${searchClause}
        AND u.department_id = ?
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(...searchArgs, requester.department_id, ...excluded)
  } else {
    // Sem departamento configurado: mostra todos (sistema ainda não estruturado)
    users = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.system_role,
             d.name as department_name, d.color as department_color
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${searchClause}
        AND u.id NOT IN (${placeholders})
      ORDER BY u.name LIMIT 10
    `).all(...searchArgs, ...excluded)
  }

  return c.json(users)
})

export default app
