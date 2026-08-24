import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import MemberPicker from '../components/common/MemberPicker'
import { confirmDialog } from '../store/dialogStore'
import { avatarColor } from '../utils/avatarColor'
import s from './AdminPage.module.css'

const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#64748b']

const ROLE_LABELS = {
  super_admin: { label: '⭐ Super Admin', color: '#f59e0b' },
  user:        { label: '👤 Usuário',     color: '#64748b' },
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

/**
 * Chips + "adicionar destinatário" reaproveitado nas 3 listas de
 * destinatário desta página (regra de SLA, resumo semanal, alerta diário) —
 * mesmo padrão de MemberPicker + e-mail livre usado no CardModal pra membros.
 */
function RecipientChips({ recipients, onAddUser, onAddEmail, onRemove }) {
  const [showPicker, setShowPicker] = useState(false)
  const [emailInput, setEmailInput] = useState('')

  const submitEmail = () => {
    const email = emailInput.trim()
    if (!email) return
    onAddEmail(email)
    setEmailInput('')
  }

  return (
    <div className={s.recipientsBox}>
      <div className={s.chipsRow}>
        {recipients.map(r => (
          <span key={r.id} className={s.chip}>
            {r.user_id && (
              <span className={s.chipDot} style={{ background: avatarColor(r.user_id) }}>
                {(r.user_name || '?').charAt(0).toUpperCase()}
              </span>
            )}
            {r.user_name || r.email}
            <button type="button" className={s.chipRemove} onClick={() => onRemove(r.id)}>×</button>
          </span>
        ))}
        {recipients.length === 0 && <span className={s.emptyHint}>Nenhum destinatário ainda.</span>}
      </div>
      <div className={s.addRecipientRow}>
        <div className={s.inviteWrap}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPicker(v => !v)}>
            + Adicionar destinatário
          </button>
          {showPicker && (
            <MemberPicker
              existingIds={recipients.filter(r => r.user_id).map(r => r.user_id)}
              onPick={u => { onAddUser(u); setShowPicker(false) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        <span className={s.orSep}>ou digite um e-mail externo</span>
        <input
          className={s.emailInput}
          placeholder="email@externo.com"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitEmail()}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={submitEmail} disabled={!emailInput.trim()}>
          + Adicionar
        </button>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { user: me } = useAuthStore()
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [newDept, setNewDept] = useState({ name: '', color: '#4a7cf7' })
  const [deptMsg, setDeptMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── SLA ───────────────────────────────────────────────────
  const [boards, setBoards] = useState([])
  const [slaRules, setSlaRules] = useState([])
  const [newRule, setNewRule] = useState({ name: '', board_id: '', threshold_hours: 24 })
  const [ruleMsg, setRuleMsg] = useState(null)
  const [creatingRule, setCreatingRule] = useState(false)

  // ── Notificações (digests + outbox) ──────────────────────
  const [settings, setSettings] = useState({})
  const [weeklyRecipients, setWeeklyRecipients] = useState([])
  const [dailyRecipients, setDailyRecipients] = useState([])
  const [outbox, setOutbox] = useState({ rows: [], pendingCount: 0 })
  const [settingsMsg, setSettingsMsg] = useState(null)

  useEffect(() => {
    if (me && me.system_role !== 'super_admin') { navigate('/'); return }
    Promise.all([
      api.get('/admin/users'),
      api.get('/admin/departments'),
      api.get('/boards').catch(() => ({ data: [] })),
      api.get('/admin/sla-rules').catch(() => ({ data: [] })),
      api.get('/admin/settings').catch(() => ({ data: {} })),
      api.get('/admin/settings/digest-recipients', { params: { type: 'weekly' } }).catch(() => ({ data: [] })),
      api.get('/admin/settings/digest-recipients', { params: { type: 'daily' } }).catch(() => ({ data: [] })),
      api.get('/admin/settings/email-outbox').catch(() => ({ data: { rows: [], pendingCount: 0 } })),
    ]).then(([u, d, b, rules, set, weekly, daily, ob]) => {
      setUsers(u.data)
      setDepartments(d.data)
      setBoards(b.data || [])
      setSlaRules(rules.data || [])
      setSettings(set.data || {})
      setWeeklyRecipients(weekly.data || [])
      setDailyRecipients(daily.data || [])
      setOutbox(ob.data || { rows: [], pendingCount: 0 })
      setLoading(false)
    })
  }, [me])

  // ── Usuários ──────────────────────────────────────────────
  const updateUser = async (userId, patch) => {
    const { data } = await api.put(`/admin/users/${userId}`, patch)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u))
  }

  const deleteUser = async (userId) => {
    if (!(await confirmDialog('Excluir este usuário? Isso não pode ser desfeito.'))) return
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
    if (!(await confirmDialog('Excluir departamento? Os usuários associados perderão o vínculo.'))) return
    await api.delete(`/admin/departments/${id}`)
    setDepartments(prev => prev.filter(d => d.id !== id))
    setUsers(prev => prev.map(u => u.department_id === id ? { ...u, department_id: null, department_name: null } : u))
  }

  // ── SLA ───────────────────────────────────────────────────
  const createRule = async () => {
    if (!newRule.name.trim() || !newRule.threshold_hours) return
    setCreatingRule(true)
    setRuleMsg(null)
    try {
      const { data } = await api.post('/admin/sla-rules', {
        name: newRule.name.trim(),
        board_id: newRule.board_id || null,
        threshold_hours: Number(newRule.threshold_hours),
      })
      setSlaRules(prev => [...prev, { ...data, recipients: data.recipients || [] }])
      setNewRule({ name: '', board_id: '', threshold_hours: 24 })
    } catch (e) {
      setRuleMsg({ type: 'error', text: e.response?.data?.error || 'Erro ao criar regra' })
    } finally {
      setCreatingRule(false)
    }
  }

  const toggleRuleActive = async (rule) => {
    const nextActive = rule.active ? 0 : 1
    setSlaRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: nextActive } : r))
    try {
      await api.put(`/admin/sla-rules/${rule.id}`, { active: nextActive })
    } catch {
      setSlaRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: rule.active } : r))
    }
  }

  const deleteRule = async (id) => {
    if (!(await confirmDialog('Excluir esta regra de SLA?'))) return
    await api.delete(`/admin/sla-rules/${id}`)
    setSlaRules(prev => prev.filter(r => r.id !== id))
  }

  const addRuleRecipientUser = async (ruleId, user) => {
    const { data } = await api.post(`/admin/sla-rules/${ruleId}/recipients`, { user_id: user.id })
    setSlaRules(prev => prev.map(r => r.id === ruleId ? { ...r, recipients: [...(r.recipients || []), data] } : r))
  }

  const addRuleRecipientEmail = async (ruleId, email) => {
    const { data } = await api.post(`/admin/sla-rules/${ruleId}/recipients`, { email })
    setSlaRules(prev => prev.map(r => r.id === ruleId ? { ...r, recipients: [...(r.recipients || []), data] } : r))
  }

  const removeRuleRecipient = async (ruleId, recipientId) => {
    await api.delete(`/admin/sla-rules/${ruleId}/recipients/${recipientId}`)
    setSlaRules(prev => prev.map(r => r.id === ruleId ? { ...r, recipients: (r.recipients || []).filter(x => x.id !== recipientId) } : r))
  }

  // ── Notificações ──────────────────────────────────────────
  const updateSetting = async (key, value) => {
    setSettingsMsg(null)
    setSettings(prev => ({ ...prev, [key]: value }))
    try {
      await api.put('/admin/settings', { [key]: value })
    } catch (e) {
      setSettingsMsg({ type: 'error', text: 'Erro ao salvar configuração' })
    }
  }

  const addDigestUser = async (type, user) => {
    const { data } = await api.post('/admin/settings/digest-recipients', { digest_type: type, user_id: user.id })
    if (type === 'weekly') setWeeklyRecipients(prev => [...prev, data])
    else setDailyRecipients(prev => [...prev, data])
  }

  const addDigestEmail = async (type, email) => {
    const { data } = await api.post('/admin/settings/digest-recipients', { digest_type: type, email })
    if (type === 'weekly') setWeeklyRecipients(prev => [...prev, data])
    else setDailyRecipients(prev => [...prev, data])
  }

  const removeDigestRecipient = async (type, id) => {
    await api.delete(`/admin/settings/digest-recipients/${id}`)
    if (type === 'weekly') setWeeklyRecipients(prev => prev.filter(r => r.id !== id))
    else setDailyRecipients(prev => prev.filter(r => r.id !== id))
  }

  const outboxRows = outbox.rows ?? outbox.results ?? []
  const pendingOutboxCount = outbox.pendingCount ?? outboxRows.length ?? 0

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
        <button className={`${s.tab} ${tab === 'sla' ? s.active : ''}`} onClick={() => setTab('sla')}>
          ⏱️ SLA <span className={s.badge}>{slaRules.length}</span>
        </button>
        <button className={`${s.tab} ${tab === 'notifications' ? s.active : ''}`} onClick={() => setTab('notifications')}>
          📧 Notificações
        </button>
      </div>

      {/* ── Tab: Usuários ── */}
      {tab === 'users' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>🔐 Como funciona:</strong> Defina o <em>departamento</em> de cada usuário para organizar a equipe por setor. Promova a <em>Super Admin</em> quem deve ter acesso irrestrito ao sistema.
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

      {/* ── Tab: Departamentos ── */}
      {tab === 'departments' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>🏢 Departamentos</strong> agrupam usuários por equipe dentro da organização.
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

      {/* ── Tab: SLA ── */}
      {tab === 'sla' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>⏱️ Como funciona:</strong> Crie regras que avisam destinatários quando um card fica <em>parado</em> (sem atividade) por tempo demais. Aplique a um quadro específico ou a todos.
          </div>

          <div className={s.ruleList}>
            {slaRules.map(rule => (
              <div key={rule.id} className={s.ruleCard}>
                <div className={s.ruleHeader}>
                  <div>
                    <div className={s.ruleName}>{rule.name}</div>
                    <div className={s.ruleMeta}>
                      {rule.board_name || 'Todos os quadros'} · limite de {rule.threshold_hours}h sem atividade
                    </div>
                  </div>
                  <div className={s.ruleActions}>
                    <label className={s.switch} title={rule.active ? 'Ativa' : 'Inativa'}>
                      <input type="checkbox" checked={!!rule.active} onChange={() => toggleRuleActive(rule)} />
                      <span className={s.switchTrack} />
                    </label>
                    <button className="btn btn-icon btn-sm" style={{ color:'var(--red)' }} onClick={() => deleteRule(rule.id)} title="Excluir regra">🗑️</button>
                  </div>
                </div>
                <RecipientChips
                  recipients={rule.recipients || []}
                  onAddUser={u => addRuleRecipientUser(rule.id, u)}
                  onAddEmail={email => addRuleRecipientEmail(rule.id, email)}
                  onRemove={recipientId => removeRuleRecipient(rule.id, recipientId)}
                />
              </div>
            ))}
            {slaRules.length === 0 && (
              <p style={{ color:'var(--muted)', fontSize:13 }}>Nenhuma regra de SLA criada ainda.</p>
            )}
          </div>

          <div className={s.addDeptForm}>
            <p style={{ fontSize:13, fontWeight:600, margin:'0 0 10px', color:'var(--white)' }}>+ Criar regra de SLA</p>
            <div className={s.ruleFormGrid}>
              <input
                placeholder="Nome da regra"
                value={newRule.name}
                onChange={e => { setNewRule(r => ({ ...r, name: e.target.value })); setRuleMsg(null) }}
              />
              <select value={newRule.board_id} onChange={e => setNewRule(r => ({ ...r, board_id: e.target.value }))}>
                <option value="">Todos os quadros</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input
                type="number"
                min={1}
                placeholder="Horas sem atividade"
                value={newRule.threshold_hours}
                onChange={e => setNewRule(r => ({ ...r, threshold_hours: e.target.value }))}
              />
              <button className="btn btn-primary btn-sm" onClick={createRule} disabled={!newRule.name.trim() || !newRule.threshold_hours || creatingRule}>
                {creatingRule ? 'Criando...' : '+ Criar'}
              </button>
            </div>
            {ruleMsg && (
              <p style={{ fontSize:12, color: ruleMsg.type === 'error' ? 'var(--red)' : 'var(--green)', marginTop:6 }}>
                {ruleMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Notificações ── */}
      {tab === 'notifications' && (
        <div className={s.section}>
          <div className={s.info}>
            <strong>📧 Como funciona:</strong> Configure o resumo semanal e o alerta diário por e-mail. Destinatários que são usuários do sistema também recebem uma notificação dentro do app.
          </div>

          {/* Resumo semanal */}
          <div className={s.digestCard}>
            <div className={s.digestHeader}>
              <div>
                <h3 className={s.digestTitle}>Resumo semanal</h3>
                <p className={s.digestSub}>Envia um resumo dos eventos da semana.</p>
              </div>
              <label className={s.switch}>
                <input
                  type="checkbox"
                  checked={settings.weekly_digest_enabled === 'true'}
                  onChange={e => updateSetting('weekly_digest_enabled', e.target.checked ? 'true' : 'false')}
                />
                <span className={s.switchTrack} />
              </label>
            </div>

            {settings.weekly_digest_enabled === 'true' && (
              <div className={s.digestConfigRow}>
                <label className={s.smallLabel}>
                  Dia da semana
                  <select
                    value={settings.weekly_digest_weekday ?? '0'}
                    onChange={e => updateSetting('weekly_digest_weekday', e.target.value)}
                  >
                    {WEEKDAYS.map((w, i) => <option key={i} value={String(i)}>{w}</option>)}
                  </select>
                </label>
                <label className={s.smallLabel}>
                  Horário
                  <select
                    value={settings.weekly_digest_hour ?? '8'}
                    onChange={e => updateSetting('weekly_digest_hour', e.target.value)}
                  >
                    {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </label>
              </div>
            )}

            <RecipientChips
              recipients={weeklyRecipients}
              onAddUser={u => addDigestUser('weekly', u)}
              onAddEmail={email => addDigestEmail('weekly', email)}
              onRemove={id => removeDigestRecipient('weekly', id)}
            />
          </div>

          {/* Alerta diário */}
          <div className={s.digestCard}>
            <div className={s.digestHeader}>
              <div>
                <h3 className={s.digestTitle}>Alerta diário</h3>
                <p className={s.digestSub}>Envia um aviso diário com os eventos do dia seguinte.</p>
              </div>
              <label className={s.switch}>
                <input
                  type="checkbox"
                  checked={settings.daily_digest_enabled === 'true'}
                  onChange={e => updateSetting('daily_digest_enabled', e.target.checked ? 'true' : 'false')}
                />
                <span className={s.switchTrack} />
              </label>
            </div>

            {settings.daily_digest_enabled === 'true' && (
              <div className={s.digestConfigRow}>
                <label className={s.smallLabel}>
                  Horário
                  <select
                    value={settings.daily_digest_hour ?? '22'}
                    onChange={e => updateSetting('daily_digest_hour', e.target.value)}
                  >
                    {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </label>
              </div>
            )}

            <RecipientChips
              recipients={dailyRecipients}
              onAddUser={u => addDigestUser('daily', u)}
              onAddEmail={email => addDigestEmail('daily', email)}
              onRemove={id => removeDigestRecipient('daily', id)}
            />
          </div>

          {settingsMsg && (
            <p style={{ fontSize:12, color:'var(--red)' }}>{settingsMsg.text}</p>
          )}

          {/* Fila de e-mail */}
          <div className={s.outboxCard}>
            <h3 className={s.digestTitle}>Fila de e-mail</h3>
            <p className={s.outboxNote}>
              <strong>{pendingOutboxCount} {pendingOutboxCount === 1 ? 'e-mail' : 'e-mails'}</strong> aguardando o domínio de envio ser configurado. Isso é esperado por enquanto — os e-mails ficam guardados e serão enviados automaticamente assim que o domínio for configurado.
            </p>
            {outboxRows.length > 0 && (
              <div className={s.outboxTable}>
                <div className={s.outboxHead}>
                  <span>Assunto</span><span>Para</span><span>Status</span><span>Criado em</span>
                </div>
                {outboxRows.slice(0, 20).map(o => (
                  <div key={o.id} className={s.outboxRow}>
                    <span className={s.outboxSubject}>{o.subject}</span>
                    <span>{o.to_email || o.to_user_name || o.to_user_id || '—'}</span>
                    <span className={`badge ${o.status === 'sent' ? 'badge-green' : o.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>
                      {o.status}
                    </span>
                    <span>{o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
