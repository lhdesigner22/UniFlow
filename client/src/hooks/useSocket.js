import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

let socket = null

export function getSocket() {
  if (!socket) socket = io({ path: '/socket.io' })
  return socket
}

export function useSocket(pipeId, handlers) {
  const s = getSocket()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!pipeId) return
    s.emit('join-pipe', pipeId)
    const keys = Object.keys(handlers)
    keys.forEach(event => s.on(event, (...args) => handlersRef.current[event]?.(...args)))
    return () => {
      s.emit('leave-pipe', pipeId)
      keys.forEach(event => s.off(event))
    }
  }, [pipeId])

  return s
}
