import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import multer from 'multer'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storage = multer.diskStorage({
  destination: join(__dirname, '../../../uploads'),
  filename: (_, file, cb) => cb(null, `${uuid()}-${file.originalname}`)
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

const router = Router({ mergeParams: true })
router.use(auth)

router.post('/:cardId', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' })
  const id = uuid()
  await db.prepare('INSERT INTO card_attachments (id, card_id, user_id, filename, original_name, size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.cardId, req.user.id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype)
  res.json(await db.prepare('SELECT ca.*, u.name as user_name FROM card_attachments ca JOIN users u ON u.id = ca.user_id WHERE ca.id = ?').get(id))
})

router.delete('/:cardId/:id', async (req, res) => {
  await db.prepare('DELETE FROM card_attachments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.json({ ok: true })
})

export default router
