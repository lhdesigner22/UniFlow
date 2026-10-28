import { useState, useEffect } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { parseDbTimestamp } from '../utils/formatDuration'
import MemberPicker from '../components/common/MemberPicker'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import Avatar from '../components/common/Avatar'
import s from './TeamPerformancePage.module.css'

// Emoji de like/dislike renderiza pequeno demais e ambíguo em várias fontes
// (alguém achou que não ficava claro o que era) — troquei por ícone SVG
// próprio, mesmo padrão inline usado em Topbar.jsx, que aceita `currentColor`
// e fica nítido em qualquer tamanho/tema.
function IconThumbsUp({ size = 16, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  )
}
function IconThumbsDown({ size = 16, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  )
}

function fmtDateTime(v) {
  // Timestamps do backend vêm em UTC sem sufixo 'Z' — parseDbTimestamp trata
  // isso corretamente (mesmo helper usado em CardModal.jsx).
  return parseDbTimestamp(v).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Histórico de estrelas/luas de um colaborador — qualquer usuário logado
// pode ver quem deu cada uma; só Super Admin pode remover um lançamento.
function HistoryModal({ member, onClose, onEventRemoved, canRemove }) {
  const [events, setEvents] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  const toggleExpanded = id => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    api.get(`/team-kudos/members/${member.id}/events`)
      .then(r => setEvents(r.data || []))
      .catch(() => setEvents([]))
  }, [member.id])

  const removeEvent = async ev => {
    setRemovingId(ev.id)
    try {
      const { data } = await api.delete(`/team-kudos/events/${ev.id}`)
      setEvents(prev => prev.filter(e => e.id !== ev.id))
      onEventRemoved(member.id, data.stars, data.moons)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Modal title={`Histórico — ${member.user_name}`} onClose={onClose} width={480}>
      {events === null ? (
        <p className={s.emptyHint}>Carregando...</p>
      ) : events.length === 0 ? (
        <p className={s.emptyHint}>Nenhum lançamento ainda.</p>
      ) : (
        <div className={s.historyList}>
          {events.map(ev => (
            <div key={ev.id} className={s.historyRow}>
              <span className={`${s.historyIcon} ${ev.type === 'star' ? s.iconLike : s.iconDislike}`}>
                {ev.type === 'star' ? <IconThumbsUp size={14} /> : <IconThumbsDown size={14} />}
              </span>
              <div className={s.historyInfo}>
                <span className={s.historyGiver}>{ev.given_by_name}</span>
                {ev.comment ? (
                  <span
                    className={`${s.historyMeta} ${expandedIds.has(ev.id) ? s.historyMetaExpanded : ''}`}
                    onClick={() => toggleExpanded(ev.id)}
                    title={expandedIds.has(ev.id) ? 'Clique para recolher' : 'Clique para ver o comentário completo'}
                  >
                    {fmtDateTime(ev.created_at)} · "{ev.comment}"
                  </span>
                ) : (
                  <span className={s.historyMeta}>{fmtDateTime(ev.created_at)}</span>
                )}
              </div>
              {canRemove && (
                <button
                  className={s.historyRemoveBtn}
                  title="Remover este lançamento"
                  disabled={removingId === ev.id}
                  onClick={() => removeEvent(ev)}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Modal de "dar like/dislike" — Super Admin pode descrever o motivo antes de
// confirmar (fica gravado no lançamento e aparece no Histórico).
function GiveKudosModal({ member, type, onClose, onGiven }) {
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const isLike = type === 'star'

  const submit = async () => {
    setSaving(true)
    try {
      const { data } = await api.post(`/team-kudos/members/${member.id}/events`, { type, comment: comment.trim() || undefined })
      onGiven(data)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao registrar.', { title: 'Erro', danger: true })
      setSaving(false)
    }
  }

  return (
    <Modal title={`${isLike ? 'Dar 👍' : 'Dar 👎'} — ${member.user_name}`} onClose={onClose} width={440}>
      <div className="form-group">
        <label htmlFor="team-performance-motivo-opcional" className="label">Motivo (opcional)</label>
        <textarea id="team-performance-motivo-opcional"
          autoFocus
          rows={3}
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={isLike ? 'O que essa pessoa fez bem?' : 'O que precisa melhorar?'}
        />
      </div>
      <button
        className={`btn ${isLike ? s.confirmLikeBtn : s.confirmDislikeBtn}`}
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={saving}
        onClick={submit}
      >
        {saving ? 'Salvando...' : `Confirmar ${isLike ? '👍' : '👎'}`}
      </button>
    </Modal>
  )
}

export default function TeamPerformancePage() {
  const { user } = useAuthStore()
  const [members, setMembers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)
  const [givingFor, setGivingFor] = useState(null) // { member, type } | null
  const [poppedId, setPoppedId] = useState(null)
  const isSuperAdmin = user?.system_role === 'super_admin'

  useLiveRefresh(['team-kudos'], () => load())
  const load = () => {
    api.get('/team-kudos/members')
      .then(r => setMembers(r.data || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const addMember = async u => {
    setShowPicker(false)
    try {
      const { data } = await api.post('/team-kudos/members', { user_id: u.id })
      setMembers(prev => [...(prev || []), data].sort((a, b) => a.user_name.localeCompare(b.user_name, 'pt-BR')))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao adicionar colaborador.', { title: 'Erro', danger: true })
    }
  }

  const removeMember = async m => {
    const ok = await confirmDialog(`Remover "${m.user_name}" do quadro de desempenho? O histórico de estrelas/luas dele some junto.`, { title: 'Remover colaborador' })
    if (!ok) return
    try {
      await api.delete(`/team-kudos/members/${m.id}`)
      setMembers(prev => (prev || []).filter(x => x.id !== m.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true })
    }
  }

  // Chamado pelo GiveKudosModal depois que o lançamento (com o motivo, se
  // preenchido) já foi salvo no servidor.
  const onGiven = memberId => data => {
    setMembers(prev => prev.map(x => x.id === memberId ? { ...x, stars: data.stars, moons: data.moons } : x))
    setGivingFor(null)
    // Pop rápido no placar pra dar feedback visual imediato de que o
    // like/dislike foi mesmo registrado (some sozinho depois da animação).
    setPoppedId(memberId)
    setTimeout(() => setPoppedId(id => id === memberId ? null : id), 350)
  }

  // Atualiza os totais do card na hora, quando um lançamento é removido
  // pelo histórico (ver HistoryModal).
  const onHistoryEventRemoved = (memberId, stars, moons) => {
    setMembers(prev => prev.map(x => x.id === memberId ? { ...x, stars, moons } : x))
  }

  if (loading) return <div className={s.loading}>Carregando desempenho...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Desempenho</h1>
          <p className={s.sub}>
            {isSuperAdmin ? (
              <>
                Dê <IconThumbsUp size={13} className={`${s.inlineIcon} ${s.likeText}`} /> pra reconhecer algo positivo e{' '}
                <IconThumbsDown size={13} className={`${s.inlineIcon} ${s.dislikeText}`} /> pra sinalizar algo que precisa melhorar
                {' '}(o <IconThumbsDown size={13} className={`${s.inlineIcon} ${s.dislikeText}`} /> só aparece pra quem recebeu e pro Super Admin).
              </>
            ) : (
              'Acompanhe o reconhecimento da equipe — dar e remover é só pro Super Admin.'
            )}
          </p>
        </div>
        {isSuperAdmin && (
          <div className={s.inviteWrap}>
            <button className="btn btn-primary" onClick={() => setShowPicker(v => !v)}>+ Adicionar colaborador</button>
            {showPicker && (
              <MemberPicker
                align="right"
                existingIds={(members || []).map(m => m.user_id)}
                onPick={addMember}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
        )}
      </div>

      {(members || []).length === 0 ? (
        <div className={s.empty}>
          <h3>Ninguém no quadro ainda</h3>
          <p>{isSuperAdmin ? 'Adicione o primeiro colaborador.' : 'Peça pra um Super Admin adicionar colaboradores aqui.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {members.map((m, i) => (
            <Reveal key={m.id} delay={Math.min(i, 10) * 50} className={s.card}>
              {isSuperAdmin && (
                <button className={s.removeBtn} title="Remover do quadro" onClick={() => removeMember(m)}>✕</button>
              )}
              <Avatar id={m.user_id} name={m.user_name} photo={m.user_avatar} size={64} />
              <h3 className={s.cardName}>{m.user_name}</h3>
              <div className={`${s.scoreRow} ${poppedId === m.id ? s.scorePop : ''}`}>
                <span className={s.scoreStars}><IconThumbsUp size={14} /> {m.stars}</span>
                {m.moons != null && <span className={s.scoreMoons}><IconThumbsDown size={14} /> {m.moons}</span>}
              </div>
              {isSuperAdmin && (
                <div className={s.actionsRow}>
                  <button className={`btn btn-ghost btn-sm ${s.likeBtn}`} onClick={() => setGivingFor({ member: m, type: 'star' })}>+ <IconThumbsUp size={13} /></button>
                  <button className={`btn btn-ghost btn-sm ${s.dislikeBtn}`} onClick={() => setGivingFor({ member: m, type: 'moon' })}>+ <IconThumbsDown size={13} /></button>
                </div>
              )}
              <button className={s.historyLink} onClick={() => setHistoryFor(m)}>📋 Histórico</button>
            </Reveal>
          ))}
        </div>
      )}

      {historyFor && (
        <HistoryModal
          member={historyFor}
          canRemove={isSuperAdmin}
          onClose={() => setHistoryFor(null)}
          onEventRemoved={onHistoryEventRemoved}
        />
      )}

      {givingFor && (
        <GiveKudosModal
          member={givingFor.member}
          type={givingFor.type}
          onClose={() => setGivingFor(null)}
          onGiven={onGiven(givingFor.member.id)}
        />
      )}
    </div>
  )
}
