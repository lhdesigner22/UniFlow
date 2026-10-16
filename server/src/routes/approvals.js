import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { createNotification } from './notifications.js'
import { driveUploadFile, driveDownloadFile, driveDeleteFile, driveConfigured } from '../lib/driveClient.js'

// Aprovações estilo Microsoft Teams — qualquer usuário logado pode pedir
// aprovação de qualquer outro (sem restrição de super_admin: é uma
// ferramenta de fluxo de trabalho do dia a dia, não uma área administrativa).
const app = new Hono()
app.use('*', auth)

// 95 MB — mesmo teto aplicado em kb.js/printers.js (perto do limite real de
// corpo de requisição da Cloudflare no plano atual).
const MAX_ATTACHMENT_BYTES = 95 * 1024 * 1024

const LIST_COLUMNS = `
  a.id, a.title, a.description, a.status, a.due_date,
  a.attachment_name, a.attachment_type,
  CASE WHEN a.attachment_file_id IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
  a.requested_by, a.created_at, a.updated_at,
  u.name as requester_name, u.avatar as requester_avatar
`

async function getApproval(db, id) {
  return await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM approvals a JOIN users u ON u.id = a.requested_by WHERE a.id = ?
  `).get(id)
}

async function getApprovers(db, approvalId) {
  return await db.prepare(`
    SELECT aa.id, aa.user_id, aa.decision, aa.comment, aa.decided_at,
      u.name as user_name, u.avatar as user_avatar
    FROM approval_approvers aa JOIN users u ON u.id = aa.user_id
    WHERE aa.approval_id = ?
    ORDER BY aa.created_at
  `).all(approvalId)
}

// Reprovado se qualquer aprovador reprovar; aprovado só se TODOS aprovarem;
// senão continua pendente (ainda tem gente sem decidir).
function computeStatus(approvers) {
  if (approvers.some(a => a.decision === 'rejected')) return 'rejected'
  if (approvers.length > 0 && approvers.every(a => a.decision === 'approved')) return 'approved'
  return 'pending'
}

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// GET /?scope=received|sent — "recebidas" (padrão) = eu sou aprovador;
// "enviadas" = eu que pedi.
app.get('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const scope = c.req.query('scope') === 'sent' ? 'sent' : 'received'

  const rows = scope === 'sent'
    ? await db.prepare(`
        SELECT ${LIST_COLUMNS} FROM approvals a JOIN users u ON u.id = a.requested_by
        WHERE a.requested_by = ? ORDER BY a.created_at DESC
      `).all(user.id)
    : await db.prepare(`
        SELECT ${LIST_COLUMNS} FROM approvals a
        JOIN users u ON u.id = a.requested_by
        JOIN approval_approvers aa ON aa.approval_id = a.id
        WHERE aa.user_id = ? ORDER BY a.created_at DESC
      `).all(user.id)

  for (const row of rows) {
    row.approvers = await getApprovers(db, row.id)
    row.my_decision = row.approvers.find(x => x.user_id === user.id)?.decision || null
  }

  return c.json(rows)
})

// GET /:id
app.get('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await getApproval(db, id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)

  approval.approvers = await getApprovers(db, id)
  const isApprover = approval.approvers.some(a => a.user_id === user.id)
  if (approval.requested_by !== user.id && !isApprover) return c.json({ error: 'Sem acesso a esta aprovação' }, 403)

  return c.json(approval)
})

// POST / — cria pedido de aprovação, o driver (se houver) sobe depois via
// POST /:id/attachment (mesmo padrão em dois passos da Base de Conhecimento)
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { title, description, due_date, approver_ids } = await c.req.json()
  if (!title?.trim()) return c.json({ error: 'Título é obrigatório' }, 400)

  const approverIds = [...new Set(Array.isArray(approver_ids) ? approver_ids : [])].filter(x => x !== user.id)
  if (approverIds.length === 0) return c.json({ error: 'Escolha pelo menos um aprovador' }, 400)

  const id = uuid()
  await db.prepare(`
    INSERT INTO approvals (id, title, description, requested_by, due_date) VALUES (?, ?, ?, ?, ?)
  `).run(id, title.trim(), description || null, user.id, due_date || null)

  for (const approverId of approverIds) {
    await db.prepare('INSERT INTO approval_approvers (id, approval_id, user_id) VALUES (?, ?, ?)')
      .run(uuid(), id, approverId)
    try {
      await createNotification(db, approverId, 'approval', 'Nova solicitação de aprovação', `${user.name}: ${title.trim()}`, null)
    } catch (err) {
      console.error('Falha ao notificar aprovador:', err)
    }
  }

  const approval = await getApproval(db, id)
  approval.approvers = await getApprovers(db, id)
  return c.json(approval)
})

// POST /:id/decide — só um aprovador designado — { decision: 'approved'|'rejected', comment }
app.post('/:id/decide', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)

  const approverRow = await db.prepare('SELECT * FROM approval_approvers WHERE approval_id = ? AND user_id = ?').get(id, user.id)
  if (!approverRow) return c.json({ error: 'Você não é aprovador desta solicitação' }, 403)

  const { decision, comment } = await c.req.json()
  if (!['approved', 'rejected'].includes(decision)) return c.json({ error: 'decision inválida' }, 400)

  await db.prepare(`
    UPDATE approval_approvers SET decision = ?, comment = ?, decided_at = datetime('now') WHERE id = ?
  `).run(decision, comment || null, approverRow.id)

  const approvers = await getApprovers(db, id)
  const newStatus = computeStatus(approvers)
  await db.prepare(`UPDATE approvals SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, id)

  try {
    const title = decision === 'approved' ? 'Solicitação aprovada' : 'Solicitação reprovada'
    await createNotification(db, approval.requested_by, 'approval', title, `${user.name}: ${approval.title}`, null)
  } catch (err) {
    console.error('Falha ao notificar solicitante:', err)
  }

  const updated = await getApproval(db, id)
  updated.approvers = approvers
  return c.json(updated)
})

// DELETE /:id — só quem pediu, ou super_admin. Cascade nos aprovadores + anexo no Drive.
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)
  if (approval.requested_by !== user.id && !(await isSuperAdmin(db, user.id))) {
    return c.json({ error: 'Sem permissão' }, 403)
  }

  if (approval.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: approval.attachment_file_id }).catch(() => {})
  }
  await db.batch([
    { sql: 'DELETE FROM approval_approvers WHERE approval_id = ?', args: [id] },
    { sql: 'DELETE FROM approvals WHERE id = ?', args: [id] },
  ])
  return c.json({ ok: true })
})

// GET /:id/attachment — repassa o stream do Drive direto (quem pediu ou qualquer aprovador)
app.get('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)
  const approvers = await getApprovers(db, id)
  const allowed = approval.requested_by === user.id || approvers.some(a => a.user_id === user.id)
  if (!allowed) return c.json({ error: 'Sem acesso' }, 403)
  if (!approval.attachment_file_id) return c.json({ error: 'Sem anexo' }, 404)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  let upstream
  try {
    upstream = await driveDownloadFile(c.env, { fileId: approval.attachment_file_id })
  } catch (e) {
    return c.json({ error: `Falha ao buscar o anexo: ${e.message}` }, 502)
  }
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => '')
    return c.json({ error: `Falha ao buscar o anexo (Drive respondeu ${upstream.status}): ${body.slice(0, 300)}` }, 502)
  }

  const filename = (approval.attachment_name || 'anexo').replace(/"/g, '')
  return c.body(upstream.body, 200, {
    'Content-Type': approval.attachment_type || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(approval.attachment_name || 'anexo')}`,
  })
})

// POST /:id/attachment — só quem pediu (multipart/form-data, campo "file")
app.post('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)
  if (approval.requested_by !== user.id) return c.json({ error: 'Sem permissão' }, 403)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  // Barra pelo tamanho declarado ANTES de ler o corpo: o parseBody carrega
  // tudo na memória do Worker (128 MB) antes da checagem de file.size abaixo.
  // (+1 MB de folga pros cabeçalhos do multipart.)
  if (Number(c.req.header('Content-Length') || 0) > MAX_ATTACHMENT_BYTES + 1024 * 1024)
    return c.json({ error: 'Arquivo grande demais — máx. 95 MB.' }, 413)
  const body = await c.req.parseBody()
  const file = body.file
  if (!file || typeof file === 'string') return c.json({ error: 'Nenhum arquivo enviado' }, 400)
  if (file.size > MAX_ATTACHMENT_BYTES)
    return c.json({ error: `Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB.` }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileName = `approval-${id}-${Date.now()}-${file.name}`

  let uploaded
  try {
    uploaded = await driveUploadFile(c.env, { fileName, contentType: file.type, data: bytes })
  } catch (e) {
    return c.json({ error: `Falha ao enviar o anexo: ${e.message}` }, 502)
  }

  if (approval.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: approval.attachment_file_id }).catch(() => {})
  }

  await db.prepare(`
    UPDATE approvals SET attachment_name = ?, attachment_type = ?, attachment_file_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(file.name, file.type || 'application/octet-stream', uploaded.fileId, id)

  const updated = await getApproval(db, id)
  updated.approvers = await getApprovers(db, id)
  return c.json(updated)
})

// DELETE /:id/attachment — só quem pediu
app.delete('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const approval = await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
  if (!approval) return c.json({ error: 'Aprovação não encontrada' }, 404)
  if (approval.requested_by !== user.id) return c.json({ error: 'Sem permissão' }, 403)

  if (approval.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: approval.attachment_file_id }).catch(() => {})
  }
  await db.prepare(`
    UPDATE approvals SET attachment_name = NULL, attachment_type = NULL, attachment_file_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(id)

  const updated = await getApproval(db, id)
  updated.approvers = await getApprovers(db, id)
  return c.json(updated)
})

export default app
