import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
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
  cors: { origin: process.env.CLIENT_URL, credentials: true }
})

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))
app.use(express.json())
app.use('/uploads', express.static(join(__dirname, '../../uploads')))

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
