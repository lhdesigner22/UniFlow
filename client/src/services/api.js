import axios from 'axios'

// Same-origin agora: o Worker serve tanto os assets estáticos quanto /api/*,
// então não precisa mais de VITE_API_URL apontando pra um backend separado.
const baseURL = '/api'

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
      // Don't treat auth-endpoint 401s as "session expired".
      // A failed login attempt is NOT the same as an expired session.
      const url = err.config?.url || ''
      const isAuthEndpoint =
        url.includes('/auth/login') ||
        url.includes('/auth/google') ||
        url.includes('/auth/register')
      if (!isAuthEndpoint) {
        localStorage.removeItem('token')
        // Dispatch event instead of hard-reloading — lets React Router
        // redirect cleanly and allows fetchMe() to use its own catch logic.
        window.dispatchEvent(new CustomEvent('app:unauthorized'))
      }
    }
    return Promise.reject(err)
  }
)

export default api
