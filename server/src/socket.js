// Singleton que guarda a instância do Socket.io para que
// as rotas REST possam emitir eventos sem importar index.js.

let _io = null

export function initSocket(io) {
  _io = io
}

/**
 * Emite um evento para todos os clientes presentes na sala de uma pipe.
 * @param {string} pipeId
 * @param {string} event  nome do evento (ex: 'card-updated')
 * @param {object} data
 */
export function emitToPipe(pipeId, event, data) {
  if (!_io) return
  _io.to(`pipe:${pipeId}`).emit(event, data)
}
