import { useState, useEffect } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { parseDbTimestamp } from '../utils/formatDuration'
import MemberPicker from '../components/common/MemberPicker'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
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
    <Modal title={`Histórico de ${member.user_name}`} onClose={onClose} width={520}>
      {events === null ? (
        <p className={s.emptyHint}>Carregando...</p>
      ) : events.length === 0 ? (
        <p className={s.emptyHint}>Nenhum lançamento ainda.</p>
      ) : (
        <div className={s.historyList}>
          {events.map(ev => (
            <div key={ev.id} className={s.historyRow}>
              <span className={`${s.historyIcon} ${ev.type === 'star' ? s.iconLike : s.iconDislike}`}
                aria-label={ev.type === 'star' ? 'Reconhecimento' : 'Ponto de melhoria'} role="img">
                {ev.type === 'star' ? <IconThumbsUp size={14} /> : <IconThumbsDown size={14} />}
              </span>
              <div className={s.historyInfo}>
                <span className={s.historyHead}>
                  <span className={s.historyGiver}>{ev.given_by_name}</span>
                  <span className={s.historyMeta}>{fmtDateTime(ev.created_at)}</span>
                </span>
                {ev.comment
                  ? <span className={s.historyComment}>{ev.comment}</span>
                  : <span className={s.historyMeta}>Sem motivo escrito.</span>}
              </div>
              {canRemove && (
                <button
                  className={s.historyRemoveBtn}
                  title="Remover este lançamento"
                  aria-label="Remover este lançamento"
                  disabled={removingId === ev.id}
                  onClick={() => removeEvent(ev)}
                ><LineIcon name="trash" size={14} /></button>
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
    <Modal title={isLike ? `Reconhecer ${member.user_name}` : `Ponto de melhoria para ${member.user_name}`} onClose={onClose} width={440}>
      {!isLike && <p className={s.modalNote}>Fica visível só para {member.user_name} e para o Super Admin.</p>}
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
        {saving ? 'Salvando...' : isLike ? 'Registrar reconhecimento' : 'Registrar ponto de melhoria'}
      </button>
    </Modal>
  )
}

// "hoje, 13:48" / "ontem" / "3 dias atrás" / "26/10" — o mural lê melhor com tempo relativo
function relTime(v) {
  const d = parseDbTimestamp(v)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return `hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  if (diff === 1) return 'ontem'
  if (diff < 7) return `${diff} dias atrás`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function TeamPerformancePage() {
  const { user } = useAuthStore()
  const [members, setMembers] = useState(null)
  const [recent, setRecent] = useState([])
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
    api.get('/team-kudos/recent').then(r => setRecent(r.data || [])).catch(() => {})
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
    const ok = await confirmDialog(`Tirar "${m.user_name}" do quadro de desempenho? O histórico de reconhecimentos dele some junto.`, { title: 'Tirar do quadro' })
    if (!ok) return
    try {
      await api.delete(`/team-kudos/members/${m.id}`)
      setMembers(prev => (prev || []).filter(x => x.id !== m.id))
      setRecent(prev => prev.filter(r => r.member_id !== m.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true })
    }
  }

  // Chamado pelo GiveKudosModal depois que o lançamento (com o motivo, se
  // preenchido) já foi salvo no servidor.
  const onGiven = memberId => data => {
    setMembers(prev => prev.map(x => x.id === memberId ? { ...x, stars: data.stars, moons: data.moons } : x))
    setGivingFor(null)
    api.get('/team-kudos/recent').then(r => setRecent(r.data || [])).catch(() => {})
    // Pop rápido no placar pra dar feedback visual imediato de que o
    // reconhecimento foi mesmo registrado (some sozinho depois da animação).
    setPoppedId(memberId)
    setTimeout(() => setPoppedId(id => id === memberId ? null : id), 350)
  }

  // Atualiza os totais na hora, quando um lançamento é removido pelo histórico.
  const onHistoryEventRemoved = (memberId, stars, moons) => {
    setMembers(prev => prev.map(x => x.id === memberId ? { ...x, stars, moons } : x))
    api.get('/team-kudos/recent').then(r => setRecent(r.data || [])).catch(() => {})
  }

  if (loading) return <div className={s.loading}>Carregando desempenho...</div>

  const list = members || []
  const totalStars = list.reduce((a, m) => a + (m.stars || 0), 0)

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Desempenho</h1>
          <p className={s.sub}>
            {list.length
              ? `${totalStars} ${totalStars === 1 ? 'reconhecimento' : 'reconhecimentos'} para ${list.length} ${list.length === 1 ? 'pessoa' : 'pessoas'} da equipe.`
              : 'Reconhecimento da equipe.'}{' '}
            Os pontos de melhoria só aparecem para quem recebeu e para o Super Admin.
          </p>
        </div>
        {isSuperAdmin && (
          <div className={s.inviteWrap}>
            <button className="btn btn-primary" onClick={() => setShowPicker(v => !v)}><LineIcon name="plus" size={15} /> Adicionar pessoa</button>
            {showPicker && (
              <MemberPicker
                align="right"
                existingIds={list.map(m => m.user_id)}
                onPick={addMember}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className={s.empty}>
          <h2>Ninguém no quadro ainda</h2>
          <p>{isSuperAdmin ? 'Adicione a primeira pessoa da equipe com "Adicionar pessoa".' : 'Peça para um Super Admin adicionar a equipe aqui.'}</p>
        </div>
      ) : (
        <div className={s.layout}>
          <section className={s.panel} aria-labelledby="tp-team">
            <h2 id="tp-team" className={s.panelTitle}>Equipe<span className={s.count}>{list.length}</span></h2>
            <ul className={s.roster}>
              {list.map(m => (
                <li key={m.id} className={s.person}>
                  <Avatar id={m.user_id} name={m.user_name} photo={m.user_avatar} size={36} />
                  <span className={s.personMain}>
                    <span className={s.personName}>{m.user_name}</span>
                    <span className={`${s.score} ${poppedId === m.id ? s.scorePop : ''}`}>
                      <span className={s.likes} title="Reconhecimentos"><IconThumbsUp size={13} /> {m.stars}</span>
                      {m.moons != null && <span className={s.dislikes} title="Pontos de melhoria (privado)"><IconThumbsDown size={13} /> {m.moons}</span>}
                    </span>
                  </span>
                  <span className={s.personActions}>
                    {isSuperAdmin && <>
                      <button type="button" className={`${s.actBtn} ${s.likeBtn}`} onClick={() => setGivingFor({ member: m, type: 'star' })}
                        aria-label={`Reconhecer ${m.user_name}`} title="Reconhecer"><IconThumbsUp size={14} /><span className={s.actLabel}>Reconhecer</span></button>
                      <button type="button" className={`${s.actBtn} ${s.dislikeBtn}`} onClick={() => setGivingFor({ member: m, type: 'moon' })}
                        aria-label={`Apontar ponto de melhoria para ${m.user_name}`} title="Apontar ponto de melhoria"><IconThumbsDown size={14} /></button>
                    </>}
                    <button type="button" className={s.actBtn} onClick={() => setHistoryFor(m)} aria-label={`Histórico de ${m.user_name}`} title="Histórico">
                      <LineIcon name="clock" size={14} />
                    </button>
                    {isSuperAdmin && <RowMenu name={m.user_name} items={[
                      { label: 'Tirar do quadro', hint: 'Apaga o histórico dessa pessoa aqui', icon: 'trash', danger: true, onClick: () => removeMember(m) },
                    ]} />}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={s.panel} aria-labelledby="tp-wall">
            <h2 id="tp-wall" className={s.panelTitle}>Mural de reconhecimentos</h2>
            {recent.length === 0 ? (
              <p className={s.wallEmpty}>Nenhum reconhecimento ainda. {isSuperAdmin ? 'Use "Reconhecer" ao lado do nome de alguém da equipe.' : ''}</p>
            ) : (
              <ol className={s.wall}>
                {recent.map(r => (
                  <li key={r.id} className={s.post}>
                    <Avatar id={r.user_id} name={r.user_name} photo={r.user_avatar} size={30} />
                    <div className={s.postBody}>
                      <p className={s.postHead}>
                        <strong>{r.user_name}</strong> recebeu um reconhecimento
                        <span className={s.postWhen}>{relTime(r.created_at)}</span>
                      </p>
                      {r.comment
                        ? <blockquote className={s.postQuote}>{r.comment}</blockquote>
                        : <p className={s.postNoComment}>Sem motivo escrito.</p>}
                      <p className={s.postBy}>por {r.given_by_name}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
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
