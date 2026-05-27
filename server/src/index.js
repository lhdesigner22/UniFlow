import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import usersRoutes from './routes/users.js'
import pipesRoutes from './routes/pipes.js'
import phasesRoutes from './routes/phases.js'
import cardsRoutes from './routes/cards.js'
import fieldsRoutes from './routes/fields.js'
import membersRoutes from './routes/members.js'
import pipeGroupsRoutes from './routes/pipeGroups.js'
import automationsRoutes from './routes/automations.js'
import attachmentsRoutes from './routes/attachments.js'
import formsRoutes from './routes/forms.js'
import reportsRoutes from './routes/reports.js'
import notificationsRoutes from './routes/notifications.js'
import labelsRoutes from './routes/labels.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }
})

// Middleware
const corsOrigin = process.env.CLIENT_URL || 'http://localhost:5173'
app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json())

const uploadsPath = process.env.UPLOADS_PATH || join(__dirname, '../../uploads')
app.use('/uploads', express.static(uploadsPath))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/pipes', pipesRoutes)
app.use('/api/pipes/:pipeId/phases', phasesRoutes)
app.use('/api/pipes/:pipeId/cards', cardsRoutes)
app.use('/api/pipes/:pipeId/fields', fieldsRoutes)
app.use('/api/pipes/:pipeId/members', membersRoutes)
app.use('/api/pipes/:pipeId/groups', pipeGroupsRoutes)
app.use('/api/pipes/:pipeId/automations', automationsRoutes)
app.use('/api/pipes/:pipeId/forms', formsRoutes)
app.use('/api/pipes/:pipeId/reports', reportsRoutes)
app.use('/api/pipes/:pipeId/labels', labelsRoutes)
app.use('/api/attachments', attachmentsRoutes)
app.use('/api/notifications', notificationsRoutes)

// Public form routes
app.use('/api/forms', formsRoutes)

// Socket.io — real-time collaboration
io.on('connection', socket => {
  socket.on('join-pipe', pipeId => socket.join(`pipe:${pipeId}`))
  socket.on('leave-pipe', pipeId => socket.leave(`pipe:${pipeId}`))

  socket.on('card-moved', data => socket.to(`pipe:${data.pipeId}`).emit('card-moved', data))
  socket.on('card-updated', data => socket.to(`pipe:${data.pipeId}`).emit('card-updated', data))
  socket.on('card-created', data => socket.to(`pipe:${data.pipeId}`).emit('card-created', data))
  socket.on('card-deleted', data => socket.to(`pipe:${data.pipeId}`).emit('card-deleted', data))
  socket.on('comment-added', data => socket.to(`pipe:${data.pipeId}`).emit('comment-added', data))

  socket.on('disconnect', () => {})
})

// Em produção, serve o build do React apenas se existir localmente
// (quando frontend e backend estão no mesmo servidor)
if (process.env.NODE_ENV === 'production') {
  const buildPath = join(__dirname, '../../client/dist')
  if (existsSync(buildPath)) {
    app.use(express.static(buildPath))
    app.get(/^(?!\/api|\/uploads|\/socket\.io).*/, (_req, res) => {
      res.sendFile(join(buildPath, 'index.html'))
    })
  }
}

// ── Global error handler (must be AFTER all routes) ──────────────────────────
// In Express 4, async route handlers that throw don't call next(err) automatically.
// Wrapping each handler with try/catch + next(err) makes this middleware fire,
// returning a proper JSON 500 instead of leaving the request hanging forever.
app.use((err, req, res, _next) => {
  console.error('❌ Unhandled error:', err?.message || err)
  if (!res.headersSent) {
    res.status(500).json({ error: err?.message || 'Erro interno do servidor' })
  }
})

const PORT = process.env.PORT || 3001
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} já está em uso.`)
    console.error(`   Abra outro terminal e rode:\n`)
    console.error(`   npx kill-port ${PORT}\n`)
    console.error(`   Depois digite "rs" aqui para reiniciar.\n`)
    process.exit(1)
  } else {
    throw err
  }
})
httpServer.listen(PORT, () => console.log(`🚀 UniFlow Server rodando em http://localhost:${PORT}`))
