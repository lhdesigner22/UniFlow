import { create } from 'zustand'
import api from '../services/api'

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unread: 0,

  fetch: async () => {
    try {
      const { data } = await api.get('/notifications')
      set({ notifications: data.notifications, unread: data.unread })
    } catch {}
  },

  markRead: async (id) => {
    await api.post(`/notifications/read/${id}`)
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, read: 1 } : n),
      unread: Math.max(0, s.unread - 1)
    }))
  },

  markAllRead: async () => {
    await api.post('/notifications/read-all')
    set(s => ({ notifications: s.notifications.map(n => ({ ...n, read: 1 })), unread: 0 }))
  },

  add: (notif) => set(s => ({ notifications: [notif, ...s.notifications], unread: s.unread + 1 })),
}))
