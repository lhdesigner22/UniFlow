import axios from 'axios'

// Em produção (Vercel) usa a URL do backend Render via variável de ambiente.
// Em dev, o proxy do Vite redireciona /api → localhost:3001.
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const api = axios.create({
  baseURL,
  timeout: 30000, // 30 s — request hangs no longer
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      // Dispatch event instead of hard-reloading — lets React Router
      // redirect cleanly and allows fetchMe() to use its own catch logic.
      window.dispatchEvent(new CustomEvent('app:unauthorized'))
    }
    return Promise.reject(err)
  }
)

export default api
