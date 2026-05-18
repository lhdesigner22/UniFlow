import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import RoutingAdmin from '../components/admin/RoutingAdmin'
import s from './AdminPage.module.css'

const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#64748b']

const ROLE_LABELS = {
  super_admin: { label: '⭐ Super Admin', color: '#f59e0b' },
  user:        { label: '👤 Usuário',     color: '#64748b' },
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { user: me } = useAuthStore()
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [pipes, setPipes] = useState([])
  const [newDept, setNewDept] = useState({ name: '', color: '#4a7cf7' })
  const [deptMsg, setDeptMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (me && me.system_role !== 'super_admin') { navigate('/'); return }
    Promise.all([
      api.get('/admin/users'),
      api.get('/admin/departments'),
      api.get('/admin/pipes'),
    ]).then(([u, d, p]) => {
      setUsers(u.data)
      setDepartments(d.data)
      setPipes(p.data)
      setLoading(false)
    })
  }, [me])

  // ── Usuários ──────────────────────────────────────────────
  const updateUser = async (userId, patch) => {
    const { data } = await api.put(`/admin/users/${userId}`, patch)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u))
  }

  const deleteUser = async (userId) => {
    if (!confirm('Excluir este usuário? Isso não pode ser desfeito.')) return
    await api.delete(`/admin/users/${userId}`)
    setUsers(prev => prev.filter(u => u.id !== userId))
  }

  // ── Departamentos ─────────────────────────────────────────
  const addDept = async () => {
    if (!newDept.name.trim()) return
    setDeptMsg(null)
    try {
      const { data } = await api.post('/admin/departments', newDept)
      setDepartments(prev => [...prev, data])
      setNewDept({ name: '', color: '#4a7cf7' })
    } catch (e) {
      setDeptMsg({ type: 'error', text: e.response?.data?.error || 'Erro' })
    }
  }

  const deleteDept = async (id) => {
    if (!confirm('Excluir departamento? Os usuários associados perderão o vínculo.')) return
    await api.delete(`/admin/departments/${id}`)
    setDepartments(prev => prev.filter(d => d.id !== id))
    setUsers(prev => prev.map(u => u.department_id === id ? { ...u, department_id: null, department_name: null } : u))
  }

  if (loading) return <div className={s.loading}>Carregando...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>⭐ Painel do Super Admin</h1>
          <p className={s.sub}>Gerencie usuários, departamentos e permissões do sistema.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>← Voltar</button>
      </div>

      {/* Tabs */}
      <div className={s.tabs}>
        <button className={`${s.tab} ${tab === 'users' ? s.active : ''}`} onClick={() => setTab('users')}>
          👥 Usuários <span className={s.badge}>{users.length}</span>
        </button>
        <button className={`${s.tab} ${tab === 'departments' ? s.active : ''}`} onClick={() => setTab('departments')}>
          🏢 Departamentos <span className={s.badge}>{departments.length}</span>
        </button>
        <button className={`${s.tab} ${tab === 'routing' ? s.active : ''}`} onClick={() => setTab('routing')}>
          🔀 Encaminhamento <span className={s.badge}>{pipes.length}</span>
        </button>
      </div>

      {/* ── Tab: Usuários ── */}
      {tab === 'users' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>🔐 Como funciona:</strong> Defina o <em>departamento</em> de cada usuário para que gestores só vejam o seu time na hora de adicionar colaboradores aos pipes. Promova a <em>Super Admin</em> quem deve ter acesso irrestrito ao sistema.
          </div>
          <div className={s.table}>
            <div className={s.tableHead}>
              <span>Usuário</span>
              <span>Departamento</span>
              <span>Papel no sistema</span>
              <span></span>
            </div>
            {users.map(u => (
              <div key={u.id} className={s.tableRow}>
                <div className={s.userCell}>
                  <div className="avatar" style={{ width:34, height:34, fontSize:13, background: u.id === me?.id ? '#22c55e' : '#4a7cf7', flexShrink:0 }}>
                    {u.name?.charAt(0)}
                  </div>
                  <div>
                    <div className={s.userName}>
                      {u.name}
                      {u.id === me?.id && <span style={{ fontSize:10, color:'var(--muted)', marginLeft:6 }}>(você)</span>}
                    </div>
                    <div className={s.userEmail}>{u.email}</div>
                  </div>
                </div>

                <select
                  value={u.department_id || ''}
                  onChange={e => updateUser(u.id, { department_id: e.target.value || null })}
                  className={s.select}
                >
                  <option value="">— Sem departamento</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>

                <select
                  value={u.system_role || 'user'}
                  onChange={e => updateUser(u.id, { system_role: e.target.value })}
                  className={s.select}
                  disabled={u.id === me?.id}
                >
                  <option value="user">👤 Usuário</option>
                  <option value="super_admin">⭐ Super Admin</option>
                </select>

                <button
                  className="btn btn-icon btn-sm"
                  style={{ color:'var(--red)' }}
                  onClick={() => deleteUser(u.id)}
                  disabled={u.id === me?.id}
                  title={u.id === me?.id ? 'Não é possível excluir a si mesmo' : 'Excluir usuário'}
                >🗑️</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Encaminhamento ── */}
      {tab === 'routing' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>🔀 Regras de Encaminhamento</strong> controlam para quais pessoas ou grupos cada colaborador pode encaminhar cards.
            Selecione um pipe abaixo para gerenciar seus grupos personalizados e regras.{' '}
            <em>Super Admin tem acesso a todos os pipes do sistema.</em>
          </div>
          <RoutingAdmin />
        </div>
      )}

      {/* ── Tab: Departamentos ── */}
      {tab === 'departments' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>🏢 Departamentos</strong> agrupam usuários por equipe. Um <em>Gestor de TI</em> no departamento <em>TI</em> só verá colaboradores do mesmo departamento ao adicionar membros em seus pipes.
          </div>

          <div className={s.deptGrid}>
            {departments.map(d => (
              <div key={d.id} className={s.deptCard} style={{ borderColor: d.color + '60' }}>
                <div className={s.deptDot} style={{ background: d.color }} />
                <div className={s.deptInfo}>
                  <span className={s.deptName}>{d.name}</span>
                  <span className={s.deptCount}>{d.member_count} {d.member_count === 1 ? 'membro' : 'membros'}</span>
                </div>
                <button className="btn btn-icon btn-sm" style={{ color:'var(--red)', marginLeft:'auto' }}
                  onClick={() => deleteDept(d.id)}>🗑️</button>
              </div>
            ))}
            {departments.length === 0 && (
              <p style={{ color:'var(--muted)', fontSize:13 }}>Nenhum departamento criado ainda.</p>
            )}
          </div>

          {/* Add form */}
          <div className={s.addDeptForm}>
            <p style={{ fontSize:13, fontWeight:600, margin:'0 0 10px', color:'var(--white)' }}>+ Criar departamento</p>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input
                placeholder="Ex: TI, RH, Marketing..."
                value={newDept.name}
                onChange={e => { setNewDept(d => ({ ...d, name: e.target.value })); setDeptMsg(null) }}
                onKeyDown={e => e.key === 'Enter' && addDept()}
                style={{ flex:1 }}
              />
              <div style={{ display:'flex', gap:5 }}>
                {COLORS.map(c => (
                  <button type="button" key={c} onClick={() => setNewDept(d => ({ ...d, color: c }))}
                    style={{ width:22, height:22, borderRadius:'50%', background:c, border: newDept.color === c ? '2px solid #fff' : '2px solid transparent', cursor:'pointer', flexShrink:0 }} />
                ))}
              </div>
              <button className="btn btn-primary btn-sm" onClick={addDept} disabled={!newDept.name.trim()}>
                + Criar
              </button>
            </div>
            {deptMsg && (
              <p style={{ fontSize:12, color: deptMsg.type === 'error' ? 'var(--red)' : 'var(--green)', marginTop:6 }}>
                {deptMsg.text}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
