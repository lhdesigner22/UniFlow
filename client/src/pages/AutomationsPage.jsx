import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import Modal from '../components/common/Modal'
import s from './AutomationsPage.module.css'

const TRIGGERS = [
  { value:'card_created', label:'Card criado' },
  { value:'card_moved', label:'Card movido para fase' },
  { value:'due_date_approaching', label:'Data limite se aproximando' },
  { value:'card_assigned', label:'Card atribuído a alguém' },
  { value:'field_changed', label:'Campo alterado' },
]

const ACTIONS = [
  { value:'assign_member', label:'Atribuir responsável' },
  { value:'move_to_phase', label:'Mover para fase' },
  { value:'add_label', label:'Adicionar etiqueta' },
  { value:'set_priority', label:'Definir prioridade' },
  { value:'send_notification', label:'Enviar notificação' },
]

export default function AutomationsPage() {
  const { pipeId } = useParams()
  const navigate = useNavigate()
  const [automations, setAutomations] = useState([])
  const [phases, setPhases] = useState([])
  const [members, setMembers] = useState([])
  const [labels, setLabels] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [form, setForm] = useState({ name:'', trigger_type:'card_created', trigger_config:{}, action_type:'send_notification', action_config:{} })

  useEffect(() => {
    api.get(`/pipes/${pipeId}/automations`).then(r => setAutomations(r.data))
    api.get(`/pipes/${pipeId}`).then(r => { setPhases(r.data.phases); setMembers(r.data.members); setLabels(r.data.labels) })
  }, [pipeId])

  const openCreate = () => {
    setForm({ name:'', trigger_type:'card_created', trigger_config:{}, action_type:'send_notification', action_config:{} })
    setEditingId(null)
    setShowModal(true)
  }

  const openEdit = (a) => {
    setForm({ name:a.name, trigger_type:a.trigger_type, trigger_config:JSON.parse(a.trigger_config||'{}'), action_type:a.action_type, action_config:JSON.parse(a.action_config||'{}') })
    setEditingId(a.id)
    setShowModal(true)
  }

  const save = async () => {
    if (editingId) {
      const { data } = await api.put(`/pipes/${pipeId}/automations/${editingId}`, form)
      setAutomations(prev => prev.map(a => a.id === editingId ? data : a))
    } else {
      const { data } = await api.post(`/pipes/${pipeId}/automations`, form)
      setAutomations(prev => [data, ...prev])
    }
    setShowModal(false)
  }

  const toggle = async (a) => {
    const { data } = await api.put(`/pipes/${pipeId}/automations/${a.id}`, { active: a.active ? 0 : 1 })
    setAutomations(prev => prev.map(x => x.id === a.id ? data : x))
  }

  const remove = async (id) => {
    await api.delete(`/pipes/${pipeId}/automations/${id}`)
    setAutomations(prev => prev.filter(a => a.id !== id))
    setConfirmDeleteId(null)
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/pipe/${pipeId}`)}>← Voltar</button>
        <h2>⚡ Automações</h2>
        <button className="btn btn-primary" onClick={openCreate}>+ Nova Automação</button>
      </div>

      <div className={s.body}>
        <div className={s.hint}>
          <span>💡</span>
          <span>Automações executam ações automaticamente quando eventos ocorrem no pipe, eliminando trabalho manual.</span>
        </div>

        {automations.length === 0 ? (
          <div className={s.empty}>
            <div style={{ fontSize:40, marginBottom:16 }}>⚡</div>
            <h3>Nenhuma automação ainda</h3>
            <p>Crie regras para automatizar ações repetitivas no seu pipe</p>
            <button className="btn btn-primary" onClick={openCreate}>+ Criar primeira automação</button>
          </div>
        ) : (
          <div className={s.list}>
            {automations.map(a => (
              <div key={a.id} className={`${s.card} ${!a.active ? s.inactive : ''}`}>
                <div className={s.cardHeader}>
                  <div className={s.cardTitle}>
                    <span className={`${s.statusDot} ${a.active ? s.on : s.off}`} />
                    <strong>{a.name}</strong>
                  </div>
                  <div className={s.cardActions}>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggle(a)}>{a.active ? '⏸ Pausar' : '▶ Ativar'}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(a)}>✏️ Editar</button>
                    {confirmDeleteId === a.id ? (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(a.id)}>Confirmar</button>
                      </>
                    ) : (
                      <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteId(a.id)}>🗑️</button>
                    )}
                  </div>
                </div>
                <div className={s.cardBody}>
                  <div className={s.rule}>
                    <span className="badge badge-blue">QUANDO</span>
                    <span>{TRIGGERS.find(t => t.value === a.trigger_type)?.label}</span>
                  </div>
                  <span className={s.arrow}>→</span>
                  <div className={s.rule}>
                    <span className="badge badge-green">ENTÃO</span>
                    <span>{ACTIONS.find(t => t.value === a.action_type)?.label}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={editingId ? 'Editar Automação' : 'Nova Automação'} onClose={() => setShowModal(false)} width={500}>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div className="form-group">
              <label className="label">Nome da automação</label>
              <input placeholder="Ex: Notificar quando card for criado" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">🎯 Gatilho (QUANDO)</label>
              <select value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value, trigger_config:{} }))}>
                {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {form.trigger_type === 'card_moved' && (
                <select style={{ marginTop:6 }} value={form.trigger_config.phase_id || ''} onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, phase_id: e.target.value } }))}>
                  <option value="">Qualquer fase</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="form-group">
              <label className="label">⚡ Ação (ENTÃO)</label>
              <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value, action_config:{} }))}>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {form.action_type === 'move_to_phase' && (
                <select style={{ marginTop:6 }} value={form.action_config.phase_id || ''} onChange={e => setForm(f => ({ ...f, action_config: { ...f.action_config, phase_id: e.target.value } }))}>
                  <option value="">Selecionar fase...</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {form.action_type === 'assign_member' && (
                <select style={{ marginTop:6 }} value={form.action_config.user_id || ''} onChange={e => setForm(f => ({ ...f, action_config: { ...f.action_config, user_id: e.target.value } }))}>
                  <option value="">Selecionar membro...</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
              {form.action_type === 'set_priority' && (
                <select style={{ marginTop:6 }} value={form.action_config.priority || ''} onChange={e => setForm(f => ({ ...f, action_config: { ...f.action_config, priority: e.target.value } }))}>
                  <option value="">Selecionar prioridade...</option>
                  <option value="high">🔴 Alta</option>
                  <option value="medium">🟡 Média</option>
                  <option value="low">🟢 Baixa</option>
                </select>
              )}
              {form.action_type === 'send_notification' && (
                <input style={{ marginTop:6 }} placeholder="Mensagem da notificação..." value={form.action_config.message || ''} onChange={e => setForm(f => ({ ...f, action_config: { ...f.action_config, message: e.target.value } }))} />
              )}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>✓ Salvar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
