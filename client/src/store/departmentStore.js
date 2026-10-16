import { create } from 'zustand'
import api from '../services/api'
import { useAuthStore } from './authStore'

// Lista de departamentos (id, nome, cor) pros seletores. Qualquer pessoa logada lê.
export const useDepartmentStore = create(set => ({
  departments: [],
  loaded: false,
  fetch: async () => {
    try {
      const { data } = await api.get('/users/departments')
      set({ departments: data || [], loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))

// "Ver como departamento" — só pra quem enxerga todos os departamentos. Guarda no
// navegador qual departamento está "vendo": 'all' (todos), 'geral' (só o conteúdo
// Geral) ou o id de um departamento. O servidor só usa isso pra ESTREITAR as
// listas (cabeçalho X-Department-View); nunca amplia o acesso de ninguém.
const KEY = 'deptView'
export function getDeptView() {
  try { return localStorage.getItem(KEY) || 'all' } catch { return 'all' }
}
export function setDeptView(value) {
  try {
    if (!value || value === 'all') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, value)
  } catch { /* sem localStorage: segue sem filtro */ }
}

// Departamento sugerido pra um conteúdo NOVO: o que a pessoa está "vendo" (se for um
// departamento), 'geral' → Geral (null), ou o próprio departamento dela. Quem não
// enxerga tudo ignora isso — o servidor força o departamento da pessoa.
export function defaultDepartment() {
  const view = getDeptView()
  if (view === 'geral') return null
  if (view && view !== 'all') return view
  return useAuthStore.getState().user?.department_id || null
}
