import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import api from '../services/api'
import s from './PipeSettingsPage.module.css'

const FIELD_TYPES = [
  { value:'text', label:'Texto' }, { value:'textarea', label:'Texto Longo' },
  { value:'number', label:'Número' }, { value:'date', label:'Data' },
  { value:'select', label:'Seleção' }, { value:'checkbox', label:'Caixa de Seleção' },
  { value:'email', label:'E-mail' }, { value:'phone', label:'Telefone' },
]
const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#64748b']

export default function PipeSettingsPage() {
  const { pipeId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('general')
  const [pipe, setPipe] = useState(null)
  const [phases, setPhases] = useState([])
  const [fields, setFields] = useState([])
  const [members, setMembers] = useState([])
  const [labels, setLabels] = useState([])
  const [forms, setForms] = useState([])
  const [newMemberRole, setNewMemberRole] = useState('member')
  const [memberAddLoading, setMemberAddLoading] = useState(false)
  const [memberAddMsg, setMemberAddMsg] = useState(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState([])
  const [memberSearchLoading, setMemberSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef(null)
  const dropdownRef = useRef(null)
  // Grupos customizados do pipe
  const [customGroups, setCustomGroups] = useState([])
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#4a7cf7')
  const [expandedGroup, setExpandedGroup] = useState(null)
  // Regras de encaminhamento
  const [routingRules, setRoutingRules]   = useState([])  // destinos individuais
  const [routingGroups, setRoutingGroups] = useState([])  // destinos por grupo
  const [routingLoading, setRoutingLoading] = useState(false)
  const [expandedMember, setExpandedMember] = useState(null)
  const [newField, setNewField] = useState({ name:'', type:'text', options:'' })
  const [newPhase, setNewPhase] = useState({ name:'', color:'#4a7cf7' })
  const [newLabel, setNewLabel] = useState({ name:'', color:'#4a7cf7' })

  useEffect(() => {
    api.get(`/pipes/${pipeId}`).then(r => {
      setPipe(r.data); setPhases(r.data.phases); setFields(r.data.fields)
      setMembers(r.data.members); setLabels(r.data.labels)
    })
    api.get(`/pipes/${pipeId}/forms`).then(r => setForms(r.data))
    api.get(`/pipes/${pipeId}/groups`).then(r => setCustomGroups(r.data)).catch(() => {})
    api.get(`/pipes/${pipeId}/members/routing`).then(r => setRoutingRules(r.data)).catch(() => {})
    api.get(`/pipes/${pipeId}/members/routing-groups`).then(r => setRoutingGroups(r.data)).catch(() => {})
  }, [pipeId])

  if (!pipe) return <div className={s.loading}>Carregando...</div>

  const savePipe = async () => {
    await api.put(`/pipes/${pipeId}`, pipe)
    alert('Configurações salvas!')
  }

  const addPhase = async () => {
    const { data } = await api.post(`/pipes/${pipeId}/phases`, newPhase)
    setPhases(prev => [...prev, data])
    setNewPhase({ name:'', color:'#4a7cf7' })
  }

  const deletePhase = async (id) => {
    try { await api.delete(`/pipes/${pipeId}/phases/${id}`); setPhases(prev => prev.filter(p => p.id !== id)) }
    catch (e) { alert(e.response?.data?.error || 'Erro') }
  }

  const addField = async () => {
    const opts = newField.type === 'select' ? newField.options.split('\n').filter(Boolean) : undefined
    const { data } = await api.post(`/pipes/${pipeId}/fields`, { ...newField, options: opts })
    setFields(prev => [...prev, data])
    setNewField({ name:'', type:'text', options:'' })
  }

  const deleteField = async (id) => {
    await api.delete(`/pipes/${pipeId}/fields/${id}`)
    setFields(prev => prev.filter(f => f.id !== id))
  }

  // Busca live de usuários
  useEffect(() => {
    if (memberSearch.trim().length < 2) { setMemberResults([]); setShowDropdown(false); return }
    const excludeIds = members.map(m => m.id).join(',')
    const t = setTimeout(async () => {
      setMemberSearchLoading(true)
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(memberSearch)}&exclude=${excludeIds}`)
        setMemberResults(data)
        setShowDropdown(true)
      } finally { setMemberSearchLoading(false) }
    }, 280)
    return () => clearTimeout(t)
  }, [memberSearch, members])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = e => {
      if (!dropdownRef.current?.contains(e.target) && !searchRef.current?.contains(e.target))
        setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addMemberFromSearch = async (user) => {
    setMemberAddLoading(true)
    setMemberAddMsg(null)
    setShowDropdown(false)
    setMemberSearch('')
    try {
      const { data } = await api.post(`/pipes/${pipeId}/members`, { email: user.email, role: newMemberRole })
      setMembers(prev => [...prev, {
        id: data.user.id, name: data.user.name, email: data.user.email,
        avatar: data.user.avatar, member_id: data.id, role: data.role,
      }])
      setMemberAddMsg({ type: 'success', text: `✅ ${data.user.name} adicionado!` })
      setTimeout(() => setMemberAddMsg(null), 3000)
    } catch (e) {
      setMemberAddMsg({ type: 'error', text: e.response?.data?.error || 'Erro ao adicionar.' })
    } finally { setMemberAddLoading(false) }
  }

  const changeMemberRole = async (memberId, role) => {
    await api.put(`/pipes/${pipeId}/members/${memberId}`, { role })
    setMembers(prev => prev.map(m => m.member_id === memberId ? { ...m, role } : m))
  }

  const removeMember = async (memberId) => {
    await api.delete(`/pipes/${pipeId}/members/${memberId}`)
    setMembers(prev => prev.filter(m => m.member_id !== memberId))
  }

  // ─── Routing ──────────────────────────────────────────────────────────────
  const addRoutingRule = async (from_user_id, to_user_id) => {
    setRoutingLoading(true)
    try {
      const { data } = await api.post(`/pipes/${pipeId}/members/routing`, { from_user_id, to_user_id })
      setRoutingRules(prev => [...prev, data])
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao adicionar regra')
    } finally { setRoutingLoading(false) }
  }

  const removeRoutingRule = async (ruleId) => {
    await api.delete(`/pipes/${pipeId}/members/routing/${ruleId}`)
    setRoutingRules(prev => prev.filter(r => r.id !== ruleId))
  }

  // ─── Grupos customizados ──────────────────────────────────────────────────
  const createCustomGroup = async () => {
    if (!newGroupName.trim()) return
    try {
      const { data } = await api.post(`/pipes/${pipeId}/groups`, { name: newGroupName.trim(), color: newGroupColor })
      setCustomGroups(prev => [...prev, data])
      setNewGroupName('')
    } catch (e) { alert(e.response?.data?.error || 'Erro ao criar grupo') }
  }

  const deleteCustomGroup = async (groupId) => {
    if (!confirm('Excluir este grupo? As regras de encaminhamento que usam este grupo também serão removidas.')) return
    await api.delete(`/pipes/${pipeId}/groups/${groupId}`)
    setCustomGroups(prev => prev.filter(g => g.id !== groupId))
    setRoutingGroups(prev => prev.filter(rg => !(rg.group_type === 'custom' && rg.group_value === groupId)))
  }

  const addGroupMember = async (groupId, userId) => {
    try {
      const { data } = await api.post(`/pipes/${pipeId}/groups/${groupId}/members`, { user_id: userId })
      setCustomGroups(prev => prev.map(g => g.id === groupId
        ? { ...g, members: [...g.members, data], member_count: g.member_count + 1 }
        : g
      ))
    } catch (e) { alert(e.response?.data?.error || 'Erro') }
  }

  const removeGroupMember = async (groupId, userId) => {
    await api.delete(`/pipes/${pipeId}/groups/${groupId}/members/${userId}`)
    setCustomGroups(prev => prev.map(g => g.id === groupId
      ? { ...g, members: g.members.filter(m => m.id !== userId), member_count: g.member_count - 1 }
      : g
    ))
  }

  const toggleRoutingGroup = async (from_user_id, group_type, group_value) => {
    const existing = routingGroups.find(g =>
      g.from_user_id === from_user_id && g.group_type === group_type && g.group_value === group_value
    )
    if (existing) {
      await api.delete(`/pipes/${pipeId}/members/routing-groups/${existing.id}`)
      setRoutingGroups(prev => prev.filter(g => g.id !== existing.id))
    } else {
      setRoutingLoading(true)
      try {
        const { data } = await api.post(`/pipes/${pipeId}/members/routing-groups`, { from_user_id, group_type, group_value })
        setRoutingGroups(prev => [...prev, data])
      } catch (e) {
        alert(e.response?.data?.error || 'Erro ao configurar grupo')
      } finally { setRoutingLoading(false) }
    }
  }

  const addLabel = async () => {
    const { data } = await api.post(`/pipes/${pipeId}/labels`, newLabel)
    setLabels(prev => [...prev, data])
    setNewLabel({ name:'', color:'#4a7cf7' })
  }

  const deleteLabel = async (id) => {
    await api.delete(`/pipes/${pipeId}/labels/${id}`)
    setLabels(prev => prev.filter(l => l.id !== id))
  }

  const addForm = async () => {
    const name = prompt('Nome do formulário:')
    if (!name) return
    const { data } = await api.post(`/pipes/${pipeId}/forms`, { name })
    setForms(prev => [...prev, data])
  }

  const toggleForm = async (form) => {
    const { data } = await api.put(`/pipes/${pipeId}/forms/${form.id}`, { active: form.active ? 0 : 1 })
    setForms(prev => prev.map(f => f.id === form.id ? data : f))
  }

  const TABS = [
    { id:'general',  label:'⚙️ Geral' },
    { id:'phases',   label:'📊 Fases' },
    { id:'fields',   label:'📋 Campos' },
    { id:'labels',   label:'🏷️ Etiquetas' },
    { id:'members',  label:'👥 Membros' },
    { id:'routing',  label:'🔀 Encaminhamento' },
    { id:'forms',    label:'📝 Formulários' },
  ]

  return (
    <div className={s.page}>
      <div className={s.header}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/pipe/${pipeId}`)}>← Voltar ao Board</button>
        <h2>{pipe.icon} {pipe.name} — Configurações</h2>
      </div>

      <div className={s.layout}>
        <div className={s.sidebar}>
          {TABS.map(t => (
            <button key={t.id} className={`${s.tabBtn} ${tab === t.id ? s.active : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className={s.content}>
          {/* General */}
          {tab === 'general' && (
            <div className={s.section}>
              <h3>Informações do Pipe</h3>
              <div className="form-group"><label className="label">Nome</label><input value={pipe.name} onChange={e => setPipe(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Descrição</label><textarea rows={3} value={pipe.description || ''} onChange={e => setPipe(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="form-group">
                <label className="label">Cor</label>
                <div style={{ display:'flex', gap:8 }}>
                  {COLORS.map(c => (
                    <button type="button" key={c} onClick={() => setPipe(p => ({ ...p, color: c }))}
                      style={{ width:28, height:28, borderRadius:'50%', background:c, border: pipe.color === c ? '3px solid #fff' : '2px solid transparent', cursor:'pointer' }} />
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={savePipe}>Salvar alterações</button>
            </div>
          )}

          {/* Phases */}
          {tab === 'phases' && (
            <div className={s.section}>
              <h3>Fases do Pipeline</h3>
              <div className={s.list}>
                {phases.map(p => (
                  <div key={p.id} className={s.listItem}>
                    <span className={s.dot} style={{ background: p.color }} />
                    <span>{p.name}</span>
                    {p.done ? <span className="badge badge-green">Concluída</span> : null}
                    <button className="btn btn-icon btn-sm" style={{ marginLeft:'auto', color:'var(--red)' }} onClick={() => deletePhase(p.id)}>🗑️</button>
                  </div>
                ))}
              </div>
              <div className={s.addRow}>
                <input placeholder="Nome da fase..." value={newPhase.name} onChange={e => setNewPhase(p => ({ ...p, name: e.target.value }))} />
                <div style={{ display:'flex', gap:6 }}>
                  {COLORS.map(c => (
                    <button type="button" key={c} onClick={() => setNewPhase(p => ({ ...p, color: c }))}
                      style={{ width:22, height:22, borderRadius:'50%', background:c, border: newPhase.color === c ? '2px solid #fff' : '1px solid transparent', cursor:'pointer' }} />
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={addPhase}>+ Adicionar</button>
              </div>
            </div>
          )}

          {/* Fields */}
          {tab === 'fields' && (
            <div className={s.section}>
              <h3>Campos Customizados</h3>
              <div className={s.list}>
                {fields.map(f => (
                  <div key={f.id} className={s.listItem}>
                    <span className="badge badge-blue">{FIELD_TYPES.find(t => t.value === f.type)?.label || f.type}</span>
                    <span>{f.name}</span>
                    {f.required ? <span className="badge badge-red">Obrigatório</span> : null}
                    <button className="btn btn-icon btn-sm" style={{ marginLeft:'auto', color:'var(--red)' }} onClick={() => deleteField(f.id)}>🗑️</button>
                  </div>
                ))}
              </div>
              <div className={s.addRow} style={{ flexDirection:'column', gap:10 }}>
                <div style={{ display:'flex', gap:8 }}>
                  <input placeholder="Nome do campo..." value={newField.name} onChange={e => setNewField(f => ({ ...f, name: e.target.value }))} />
                  <select style={{ width:'auto' }} value={newField.type} onChange={e => setNewField(f => ({ ...f, type: e.target.value }))}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {newField.type === 'select' && (
                  <textarea rows={3} placeholder="Opções (uma por linha)..." value={newField.options} onChange={e => setNewField(f => ({ ...f, options: e.target.value }))} />
                )}
                <button className="btn btn-primary btn-sm" onClick={addField}>+ Adicionar Campo</button>
              </div>
            </div>
          )}

          {/* Labels */}
          {tab === 'labels' && (
            <div className={s.section}>
              <h3>Etiquetas</h3>
              <div className={s.list}>
                {labels.map(l => (
                  <div key={l.id} className={s.listItem}>
                    <span style={{ width:14, height:14, borderRadius:'50%', background:l.color, display:'inline-block' }} />
                    <span>{l.name}</span>
                    <button className="btn btn-icon btn-sm" style={{ marginLeft:'auto', color:'var(--red)' }} onClick={() => deleteLabel(l.id)}>🗑️</button>
                  </div>
                ))}
              </div>
              <div className={s.addRow}>
                <input placeholder="Nome da etiqueta..." value={newLabel.name} onChange={e => setNewLabel(l => ({ ...l, name: e.target.value }))} />
                <div style={{ display:'flex', gap:6 }}>
                  {COLORS.map(c => (
                    <button type="button" key={c} onClick={() => setNewLabel(l => ({ ...l, color: c }))}
                      style={{ width:22, height:22, borderRadius:'50%', background:c, border: newLabel.color === c ? '2px solid #fff' : '1px solid transparent', cursor:'pointer' }} />
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={addLabel}>+ Adicionar</button>
              </div>
            </div>
          )}

          {/* Members */}
          {tab === 'members' && (
            <div className={s.section}>
              <h3>Membros do Pipe</h3>

              {/* Role explanation */}
              <div style={{ background:'rgba(74,124,247,.08)', border:'1px solid rgba(74,124,247,.2)', borderRadius:10, padding:'12px 16px', marginBottom:16, fontSize:13, lineHeight:1.7 }}>
                <strong>🔐 Visibilidade por papel:</strong>
                <ul style={{ margin:'6px 0 0', paddingLeft:18, color:'var(--muted)' }}>
                  <li><strong style={{ color:'var(--white)' }}>Admin</strong> — vê <em>todos</em> os cards do pipe (gestores, diretores que aprovam tudo)</li>
                  <li><strong style={{ color:'var(--white)' }}>Membro</strong> — vê <em>somente</em> os cards encaminhados para ele ou criados por ele (aprovadores específicos)</li>
                </ul>
              </div>

              <div className={s.list}>
                {members.map(m => (
                  <div key={m.id} className={s.listItem}>
                    <div className="avatar" style={{ width:32, height:32, fontSize:12, background:'#4a7cf7', flexShrink:0 }}>{m.name.charAt(0)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{m.name}</div>
                      <div style={{ fontSize:11, color:'var(--muted)' }}>{m.email}</div>
                    </div>
                    <select
                      value={m.role}
                      onChange={e => changeMemberRole(m.member_id, e.target.value)}
                      style={{ fontSize:12, padding:'3px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, color:'var(--white)', cursor:'pointer' }}
                    >
                      <option value="admin">👑 Admin</option>
                      <option value="member">👤 Membro</option>
                    </select>
                    <button className="btn btn-icon btn-sm" style={{ color:'var(--red)' }} onClick={() => removeMember(m.member_id)}>🗑️</button>
                  </div>
                ))}
              </div>

              <p style={{ fontSize:12, color:'var(--muted)', marginTop:12 }}>
                Configure regras de encaminhamento na aba <strong style={{ color:'var(--white)' }}>🔀 Encaminhamento</strong>.
              </p>

              {/* Adicionar colaborador — live search */}
              <div style={{ marginTop:8, background:'var(--navy3)', border:'1px solid var(--border2)', borderRadius:12, padding:16, display:'flex', flexDirection:'column', gap:10 }}>
                <p style={{ fontSize:13, fontWeight:600, margin:0, color:'var(--white)' }}>➕ Adicionar colaborador</p>
                <p style={{ fontSize:12, color:'var(--muted)', margin:0 }}>
                  Digite o nome ou e-mail. Você verá apenas usuários do seu departamento (Super Admin vê todos).
                </p>

                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {/* Campo de busca com dropdown */}
                  <div style={{ position:'relative', flex:'1 1 0', minWidth:0 }}>
                    <input
                      ref={searchRef}
                      placeholder="🔍 Buscar por nome ou e-mail..."
                      value={memberSearch}
                      onChange={e => { setMemberSearch(e.target.value); setMemberAddMsg(null) }}
                      onFocus={() => memberResults.length > 0 && setShowDropdown(true)}
                      disabled={memberAddLoading}
                      style={{ width:'100%' }}
                      autoComplete="off"
                    />
                    {/* Dropdown de resultados */}
                    {showDropdown && (
                      <div ref={dropdownRef} style={{
                        position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:100,
                        background:'var(--navy2)', border:'1px solid var(--border)',
                        borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,.4)',
                        overflow:'hidden',
                      }}>
                        {memberSearchLoading && (
                          <div style={{ padding:'10px 14px', fontSize:13, color:'var(--muted)' }}>Buscando...</div>
                        )}
                        {!memberSearchLoading && memberResults.length === 0 && (
                          <div style={{ padding:'10px 14px', fontSize:13, color:'var(--muted)' }}>
                            Nenhum usuário encontrado no seu departamento.
                          </div>
                        )}
                        {memberResults.map(u => (
                          <div key={u.id}
                            onClick={() => addMemberFromSearch(u)}
                            style={{
                              display:'flex', alignItems:'center', gap:10,
                              padding:'9px 14px', cursor:'pointer',
                              borderBottom:'1px solid var(--border2)',
                              transition:'background .1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--navy3)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div className="avatar" style={{ width:30, height:30, fontSize:11, background:'#4a7cf7', flexShrink:0 }}>
                              {u.name?.charAt(0)}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600 }}>{u.name}</div>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>{u.email}</div>
                            </div>
                            {u.department_name && (
                              <span style={{
                                fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                                background: (u.department_color || '#4a7cf7') + '22',
                                color: u.department_color || '#4a7cf7',
                                flexShrink:0,
                              }}>{u.department_name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <select
                    value={newMemberRole}
                    onChange={e => setNewMemberRole(e.target.value)}
                    style={{ flex:'0 0 130px', fontSize:13, padding:'0 8px', height:38, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, color:'var(--white)', cursor:'pointer' }}
                  >
                    <option value="member">👤 Membro</option>
                    <option value="admin">👑 Admin</option>
                  </select>
                </div>

                {memberAddMsg && (
                  <div style={{
                    fontSize:13, padding:'8px 12px', borderRadius:8,
                    background: memberAddMsg.type === 'success' ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
                    border: `1px solid ${memberAddMsg.type === 'success' ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.3)'}`,
                    color: memberAddMsg.type === 'success' ? 'var(--green)' : 'var(--red)',
                  }}>
                    {memberAddMsg.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Aba: Encaminhamento ── */}
          {tab === 'routing' && (() => {
            // Grupos disponíveis para usar nas regras (papel, departamento, customizados)
            const pipeRoleGroups = [
              { type:'pipe_role', value:'admin',  label:'👑 Todos os Admins do pipe' },
              { type:'pipe_role', value:'member', label:'👤 Todos os Membros do pipe' },
            ]
            const deptMap = {}
            members.forEach(m => { if (m.department_id) deptMap[m.department_id] = m.department_name })
            const deptGroups = Object.entries(deptMap).map(([id, name]) => ({ type:'department', value:id, label:`🏢 ${name}` }))
            const customGroupOptions = customGroups.map(g => ({ type:'custom', value:g.id, label:`🔖 ${g.name}`, color:g.color }))
            const allGroupOptions = [...pipeRoleGroups, ...deptGroups, ...customGroupOptions]

            return (
              <div className={s.section}>
                <h3>🔀 Encaminhamento</h3>

                {/* ─── Seção 1: Grupos Personalizados ─── */}
                <div style={{ marginBottom:28 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                    <div>
                      <h4 style={{ margin:0, fontSize:14, fontWeight:700 }}>🔖 Grupos Personalizados</h4>
                      <p style={{ fontSize:12, color:'var(--muted)', margin:'4px 0 0' }}>
                        Crie grupos com nome próprio (ex.: "Diretores", "Aprovadores TI") e use-os nas regras abaixo.
                      </p>
                    </div>
                  </div>

                  {/* Lista de grupos */}
                  <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
                    {customGroups.length === 0 && (
                      <p style={{ fontSize:13, color:'var(--muted)' }}>Nenhum grupo criado ainda.</p>
                    )}
                    {customGroups.map(g => {
                      const isOpen = expandedGroup === g.id
                      const notInGroup = members.filter(m => !g.members.some(gm => gm.id === m.id))
                      return (
                        <div key={g.id} style={{ background:'var(--navy2)', border:`1px solid ${isOpen ? g.color + '60' : 'var(--border2)'}`, borderRadius:10, overflow:'hidden' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px' }}>
                            <span style={{ width:12, height:12, borderRadius:'50%', background:g.color, flexShrink:0 }} />
                            <button
                              onClick={() => setExpandedGroup(isOpen ? null : g.id)}
                              style={{ flex:1, display:'flex', alignItems:'center', gap:8, background:'none', border:'none', color:'var(--white)', cursor:'pointer', textAlign:'left', padding:0 }}
                            >
                              <span style={{ fontSize:14, fontWeight:700 }}>{g.name}</span>
                              <span style={{ fontSize:12, color:'var(--muted)' }}>{g.member_count} {g.member_count === 1 ? 'membro' : 'membros'}</span>
                              <span style={{ fontSize:11, color:'var(--muted)', marginLeft:'auto' }}>{isOpen ? '▲' : '▼'}</span>
                            </button>
                            <button className="btn btn-icon btn-sm" style={{ color:'var(--red)', flexShrink:0 }} onClick={() => deleteCustomGroup(g.id)} title="Excluir grupo">🗑️</button>
                          </div>

                          {isOpen && (
                            <div style={{ padding:'0 14px 14px', borderTop:'1px solid var(--border2)' }}>
                              {/* Membros atuais */}
                              {g.members.length > 0 ? (
                                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10, marginBottom:10 }}>
                                  {g.members.map(m => (
                                    <span key={m.id} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, padding:'4px 8px 4px 5px', borderRadius:20, background:g.color + '20', border:`1px solid ${g.color}40` }}>
                                      <div className="avatar" style={{ width:18, height:18, fontSize:9, background:g.color, flexShrink:0 }}>{m.name.charAt(0)}</div>
                                      {m.name}
                                      <button onClick={() => removeGroupMember(g.id, m.id)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', padding:'0 0 0 2px', lineHeight:1, fontSize:12 }}>✕</button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p style={{ fontSize:12, color:'var(--muted)', margin:'10px 0 8px' }}>Grupo vazio. Adicione membros abaixo.</p>
                              )}
                              {/* Adicionar membro */}
                              {notInGroup.length > 0 && (
                                <select defaultValue="" onChange={e => { if (e.target.value) { addGroupMember(g.id, e.target.value); e.target.value = '' } }}
                                  style={{ fontSize:12, padding:'5px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, color:'var(--white)', cursor:'pointer', width:'100%' }}
                                >
                                  <option value="">➕ Adicionar membro ao grupo...</option>
                                  {notInGroup.map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
                                </select>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Criar grupo */}
                  <div style={{ background:'var(--navy3)', border:'1px solid var(--border2)', borderRadius:10, padding:14 }}>
                    <p style={{ fontSize:13, fontWeight:600, margin:'0 0 10px', color:'var(--white)' }}>+ Criar grupo</p>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input placeholder="Nome do grupo... (ex: Diretores)" value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && createCustomGroup()}
                        style={{ flex:1 }} />
                      <div style={{ display:'flex', gap:5 }}>
                        {COLORS.map(c => (
                          <button type="button" key={c} onClick={() => setNewGroupColor(c)}
                            style={{ width:20, height:20, borderRadius:'50%', background:c, border: newGroupColor === c ? '2px solid #fff' : '2px solid transparent', cursor:'pointer', flexShrink:0 }} />
                        ))}
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={createCustomGroup} disabled={!newGroupName.trim()}>+ Criar</button>
                    </div>
                  </div>
                </div>

                {/* ─── Seção 2: Regras por membro ─── */}
                <div>
                  <h4 style={{ margin:'0 0 4px', fontSize:14, fontWeight:700 }}>📋 Regras por Colaborador</h4>
                  <p style={{ fontSize:12, color:'var(--muted)', margin:'0 0 14px' }}>
                    Defina para quais <em>pessoas</em> ou <em>grupos</em> cada colaborador pode encaminhar cards.
                    <strong style={{ color:'var(--white)' }}> Sem regra = livre para encaminhar para qualquer membro.</strong>
                  </p>

                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {members.map(fromMember => {
                      const myRules  = routingRules.filter(r => r.from_user_id === fromMember.id)
                      const myGroups = routingGroups.filter(g => g.from_user_id === fromMember.id)
                      const isExpanded = expandedMember === fromMember.id
                      const hasAny = myRules.length > 0 || myGroups.length > 0
                      const availableTargets = members.filter(m => m.id !== fromMember.id && !myRules.some(r => r.to_user_id === m.id))

                      return (
                        <div key={fromMember.id} style={{ background:'var(--navy2)', border:`1px solid ${isExpanded ? 'var(--border)' : 'var(--border2)'}`, borderRadius:10, overflow:'hidden' }}>
                          {/* Cabeçalho */}
                          <button onClick={() => setExpandedMember(isExpanded ? null : fromMember.id)}
                            style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'11px 14px', background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'var(--white)' }}
                          >
                            <div className="avatar" style={{ width:30, height:30, fontSize:12, background:'#4a7cf7', flexShrink:0 }}>{fromMember.name.charAt(0)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600 }}>{fromMember.name}</div>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>{fromMember.role === 'admin' ? '👑 Admin' : '👤 Membro'}</div>
                            </div>
                            {hasAny ? (
                              <span style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20, background:'rgba(239,68,68,.15)', color:'var(--red)', flexShrink:0 }}>🔒 Restrito</span>
                            ) : (
                              <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0 }}>🟢 Livre</span>
                            )}
                            <span style={{ fontSize:11, color:'var(--muted)', marginLeft:6 }}>{isExpanded ? '▲' : '▼'}</span>
                          </button>

                          {isExpanded && (
                            <div style={{ padding:'12px 14px 14px', borderTop:'1px solid var(--border2)', display:'flex', flexDirection:'column', gap:16 }}>

                              {/* Grupos (checkboxes) */}
                              <div>
                                <p style={{ fontSize:11, fontWeight:700, color:'var(--muted)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'.06em' }}>Grupos permitidos</p>
                                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                                  {allGroupOptions.map(g => {
                                    const active = myGroups.some(mg => mg.group_type === g.type && mg.group_value === g.value)
                                    return (
                                      <label key={`${g.type}-${g.value}`} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 11px', borderRadius:8, cursor:'pointer', background: active ? 'rgba(74,124,247,.10)' : 'var(--navy3)', border:`1px solid ${active ? 'rgba(74,124,247,.3)' : 'var(--border2)'}`, transition:'all .15s' }}>
                                        <input type="checkbox" checked={active} disabled={routingLoading}
                                          onChange={() => toggleRoutingGroup(fromMember.id, g.type, g.value)}
                                          style={{ width:15, height:15, cursor:'pointer', accentColor:'var(--blue)', flexShrink:0 }} />
                                        {g.color && <span style={{ width:10, height:10, borderRadius:'50%', background:g.color, flexShrink:0 }} />}
                                        <span style={{ fontSize:13, fontWeight: active ? 600 : 400, color: active ? 'var(--white)' : 'var(--muted)' }}>{g.label}</span>
                                      </label>
                                    )
                                  })}
                                  {allGroupOptions.length === 0 && (
                                    <p style={{ fontSize:12, color:'var(--muted)', margin:0 }}>Crie grupos acima para usá-los aqui.</p>
                                  )}
                                </div>
                              </div>

                              {/* Pessoas individuais */}
                              <div>
                                <p style={{ fontSize:11, fontWeight:700, color:'var(--muted)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'.06em' }}>Pessoas específicas</p>
                                <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom: availableTargets.length > 0 ? 8 : 0 }}>
                                  {myRules.map(rule => (
                                    <div key={rule.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--navy3)', borderRadius:8, padding:'7px 10px' }}>
                                      <div className="avatar" style={{ width:22, height:22, fontSize:9, background:'#22c55e', flexShrink:0 }}>{rule.to_name?.charAt(0)}</div>
                                      <span style={{ fontSize:13, flex:1 }}>{rule.to_name}</span>
                                      <span style={{ fontSize:11, color:'var(--muted)' }}>{rule.to_email}</span>
                                      <button className="btn btn-icon btn-sm" style={{ color:'var(--red)' }} onClick={() => removeRoutingRule(rule.id)}>✕</button>
                                    </div>
                                  ))}
                                </div>
                                {availableTargets.length > 0 && (
                                  <select defaultValue=""
                                    onChange={e => { if (e.target.value) { addRoutingRule(fromMember.id, e.target.value); e.target.value = '' } }}
                                    disabled={routingLoading}
                                    style={{ width:'100%', fontSize:12, padding:'6px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, color:'var(--white)', cursor:'pointer' }}
                                  >
                                    <option value="">➕ Adicionar pessoa específica...</option>
                                    {availableTargets.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                                  </select>
                                )}
                                {!hasAny && availableTargets.length === members.length - 1 && (
                                  <p style={{ fontSize:12, color:'var(--muted)', margin:'4px 0 0', fontStyle:'italic' }}>Sem restrições — pode encaminhar para qualquer membro.</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Forms */}
          {tab === 'forms' && (
            <div className={s.section}>
              <h3>Formulários Públicos</h3>
              <p style={{ color:'var(--muted)', fontSize:13, marginBottom:16 }}>Formulários permitem que pessoas externas criem cards neste pipe.</p>
              <div className={s.list}>
                {forms.map(f => (
                  <div key={f.id} className={s.listItem}>
                    <span>📝 {f.name}</span>
                    <span className={`badge ${f.active ? 'badge-green' : 'badge-gray'}`}>{f.active ? 'Ativo' : 'Inativo'}</span>
                    <a href={`/forms/${f.public_token}`} target="_blank" className="btn btn-sm btn-ghost">🔗 Abrir</a>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggleForm(f)}>{f.active ? '⏸ Desativar' : '▶ Ativar'}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard.writeText(window.location.origin + `/forms/${f.public_token}`); alert('Link copiado!') }}>📋 Copiar Link</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary btn-sm" onClick={addForm}>+ Criar Formulário</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
