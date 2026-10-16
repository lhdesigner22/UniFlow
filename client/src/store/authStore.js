import { create } from 'zustand'
import api from '../services/api'

export const useAuthStore = create((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: true,

  loginWithGoogle: async (credential) => {
    const { data } = await api.post('/auth/google', { credential })
    localStorage.setItem('token', data.token)
    set({ user: data.user, token: data.token })
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
    window.google?.accounts?.id?.disableAutoSelect()
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me')
      set({ user: data, loading: false })
    } catch (err) {
      if (err.response?.status === 401) {
        // Token inválido ou expirado — deslogar
        localStorage.removeItem('token')
        set({ user: null, token: null, loading: false })
      } else {
        // Erro de rede ou servidor — manter sessão, usar payload do JWT como fallback
        const token = localStorage.getItem('token')
        let fallbackUser = null
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            fallbackUser = { id: payload.id, name: payload.name, email: payload.email }
          } catch {}
        }
        set({ user: fallbackUser, loading: false })
      }
    }
  },
}))
