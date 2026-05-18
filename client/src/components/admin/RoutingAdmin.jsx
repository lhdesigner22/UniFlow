import { useState, useEffect, useRef } from 'react'
import api from '../../services/api'

export default function RoutingAdmin() {
  const [users, setUsers] = useState([])   // [{ id, name, email, department_name, routing_targets: [] }]
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)   // id do usuário expandido
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Dropdown de busca para adicionar destino
  const [dropSearch, setDropSearch] = useState({})  // { [userId]: 'texto' }
  const dropRef = useRef({})

  useEffect(() => {
    api.get('/admin/routing').then(r => {
      setUsers(r.data)
      setLoading(false)
    })
  }, [])

  const addTarget = async (fromUserId, toUserId) => {
    if (!toUserId) return
    setSaving(true)
    try {
      const { data } = await api.post('/admin/routing', { from_user_id: fromUserId, to_user_id: toUserId })
      setUsers(prev => prev.map(u => u.id === fromUserId
        ? { ...u, routing_targets: [...u.routing_targets, data] }
        : u
      ))
      // Limpa o campo de busca deste usuário
      setDropSearch(prev => ({ ...prev, [fromUserId]: '' }))
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao adicionar regra')
    } finally { setSaving(false) }
  }

  const removeTarget = async (fromUserId, ruleId) => {
    await api.delete(`/admin/routing/${ruleId}`)
    setUsers(prev => prev.map(u => u.id === fromUserId
      ? { ...u, routing_targets: u.routing_targets.filter(t => t.id !== ruleId) }
      : u
    ))
  }

  const clearAllRules = async (fromUserId) => {
    if (!confirm('Remover TODAS as restrições deste usuário? Ele poderá encaminhar para qualquer pessoa.')) return
    await api.delete(`/admin/routing/user/${fromUserId}`)
    setUsers(prev => prev.map(u => u.id === fromUserId ? { ...u, routing_targets: [] } : u))
  }

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <p style={{ color:'var(--muted)', fontSize:13 }}>Carregando usuários...</p>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Barra de pesquisa */}
      <input
        placeholder="🔍 Filtrar por nome ou e-mail..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width:'100%' }}
      />

      {/* Lista de usuários */}
      {filtered.map(user => {
        const isOpen   = expanded === user.id
        const hasRules = user.routing_targets.length > 0
        // Usuários que ainda podem ser adicionados como destino
        const alreadyIds = new Set([user.id, ...user.routing_targets.map(t => t.to_user_id)])
        const availableTargets = users.filter(u => !alreadyIds.has(u.id))
        const filterText = dropSearch[user.id] || ''
        const filteredTargets = availableTargets.filter(u =>
          !filterText || u.name.toLowerCase().includes(filterText.toLowerCase()) || u.email.toLowerCase().includes(filterText.toLowerCase())
        )

        return (
          <div key={user.id} style={{
            background:'var(--navy2)',
            border:`1px solid ${isOpen ? (hasRules ? 'rgba(239,68,68,.4)' : 'var(--border)') : 'var(--border2)'}`,
            borderRadius:12,
            overflow:'hidden',
            transition:'border-color .15s',
          }}>
            {/* Cabeçalho — clicável */}
            <button
              onClick={() => setExpanded(isOpen ? null : user.id)}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'var(--white)' }}
            >
              <div className="avatar" style={{ width:36, height:36, fontSize:13, background: hasRules ? '#ef4444' : '#4a7cf7', flexShrink:0 }}>
                {user.name.charAt(0)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600 }}>{user.name}</div>
                <div style={{ fontSize:11, color:'var(--muted)', display:'flex', gap:8, alignItems:'center', marginTop:2 }}>
                  <span>{user.email}</span>
                  {user.department_name && (
                    <span style={{ padding:'1px 6px', borderRadius:20, background:'rgba(74,124,247,.15)', color:'var(--blue)', fontWeight:600 }}>
                      🏢 {user.department_name}
                    </span>
                  )}
                </div>
              </div>

              {/* Badge de status */}
              {hasRules ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background:'rgba(239,68,68,.15)', color:'var(--red)' }}>
                    🔒 {user.routing_targets.length} destino{user.routing_targets.length > 1 ? 's' : ''} permitido{user.routing_targets.length > 1 ? 's' : ''}
                  </span>
                  <div style={{ display:'flex', gap:4 }}>
                    {user.routing_targets.slice(0, 3).map(t => (
                      <div key={t.id} className="avatar" style={{ width:20, height:20, fontSize:8, background:'#22c55e', flexShrink:0 }} title={t.to_name}>
                        {t.to_name?.charAt(0)}
                      </div>
                    ))}
                    {user.routing_targets.length > 3 && (
                      <div className="avatar" style={{ width:20, height:20, fontSize:8, background:'var(--navy3)' }}>
                        +{user.routing_targets.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0 }}>🟢 Sem restrições</span>
              )}

              <span style={{ fontSize:11, color:'var(--muted)', marginLeft:8 }}>{isOpen ? '▲' : '▼'}</span>
            </button>

            {/* Painel expandido */}
            {isOpen && (
              <div style={{ borderTop:'1px solid var(--border2)', padding:'16px' }}>

                {/* Destinos atuais */}
                <p style={{ fontSize:11, fontWeight:700, color:'var(--muted)', margin:'0 0 10px', textTransform:'uppercase', letterSpacing:'.06em' }}>
                  Pode encaminhar para:
                </p>

                {user.routing_targets.length > 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                    {user.routing_targets.map(target => (
                      <div key={target.id} style={{
                        display:'flex', alignItems:'center', gap:10,
                        background:'var(--navy3)', borderRadius:8, padding:'8px 12px',
                      }}>
                        <div className="avatar" style={{ width:28, height:28, fontSize:11, background:'#22c55e', flexShrink:0 }}>
                          {target.to_name?.charAt(0)}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:600 }}>{target.to_name}</div>
                          <div style={{ fontSize:11, color:'var(--muted)' }}>{target.to_email}</div>
                        </div>
                        <button
                          className="btn btn-icon btn-sm"
                          style={{ color:'var(--red)', flexShrink:0 }}
                          onClick={() => removeTarget(user.id, target.id)}
                          title={`Remover ${target.to_name} dos destinos permitidos`}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize:13, color:'var(--muted)', margin:'0 0 14px', fontStyle:'italic' }}>
                    Sem restrições — pode encaminhar para qualquer membro do pipe.
                  </p>
                )}

                {/* Adicionar destino — busca inline */}
                {availableTargets.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    <p style={{ fontSize:11, fontWeight:700, color:'var(--muted)', margin:0, textTransform:'uppercase', letterSpacing:'.06em' }}>
                      Adicionar destino permitido:
                    </p>
                    <input
                      placeholder="🔍 Buscar usuário pelo nome ou e-mail..."
                      value={filterText}
                      onChange={e => setDropSearch(prev => ({ ...prev, [user.id]: e.target.value }))}
                      style={{ width:'100%' }}
                      autoComplete="off"
                    />
                    {filterText.length > 0 && (
                      <div style={{ background:'var(--navy3)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', maxHeight:200, overflowY:'auto' }}>
                        {filteredTargets.length === 0 && (
                          <div style={{ padding:'10px 14px', fontSize:13, color:'var(--muted)' }}>Nenhum usuário encontrado.</div>
                        )}
                        {filteredTargets.map(t => (
                          <button
                            key={t.id}
                            disabled={saving}
                            onClick={() => addTarget(user.id, t.id)}
                            style={{
                              width:'100%', display:'flex', alignItems:'center', gap:10,
                              padding:'9px 14px', background:'none', border:'none',
                              color:'var(--white)', cursor:'pointer', textAlign:'left',
                              borderBottom:'1px solid var(--border2)',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--navy2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <div className="avatar" style={{ width:26, height:26, fontSize:10, background:'#4a7cf7', flexShrink:0 }}>{t.name.charAt(0)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600 }}>{t.name}</div>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>{t.email}</div>
                            </div>
                            {t.department_name && (
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'rgba(74,124,247,.15)', color:'var(--blue)', flexShrink:0 }}>
                                🏢 {t.department_name}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Limpar todas as regras */}
                {hasRules && (
                  <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--border2)' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color:'var(--red)', fontSize:12 }}
                      onClick={() => clearAllRules(user.id)}
                    >
                      🗑️ Remover todas as restrições de {user.name.split(' ')[0]}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
