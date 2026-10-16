import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import Avatar from '../components/common/Avatar'
import MemberPicker from '../components/common/MemberPicker'
import s from './JourneyPage.module.css'

function monthYear(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
}
function fullDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function MilestoneModal({ userId, milestone, onClose, onSaved }) {
  const [form, setForm] = useState({
    event_date: milestone?.event_date || new Date().toISOString().slice(0, 10),
    title: milestone?.title || '',
    description: milestone?.description || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = milestone
        ? await api.put(`/journey/events/${milestone.id}`, form)
        : await api.post(`/journey/${userId}/events`, form)
      onSaved(data)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar.')
      setSaving(false)
    }
  }

  return (
    <Modal title={milestone ? 'Editar marco' : 'Novo marco na jornada'} onClose={onClose} width={440}>
      <div className="form-group">
        <label className="label">Data</label>
        <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
      </div>
      <div className="form-group">
        <label className="label">Título</label>
        <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Entrou na empresa, Promovido a Analista..." />
      </div>
      <div className="form-group">
        <label className="label">Detalhes (opcional)</label>
        <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      {error && <p className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.title.trim() || !form.event_date || saving} onClick={save}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

function Detail({ person, canEdit }) {
  const [data, setData] = useState(null)
  const [milestoneModal, setMilestoneModal] = useState(null) // null | {} (novo) | marco (editar)
  const [editingStory, setEditingStory] = useState(false)
  const [storyDraft, setStoryDraft] = useState('')
  const [savingStory, setSavingStory] = useState(false)

  useEffect(() => {
    setData(null)
    setEditingStory(false)
    api.get(`/journey/${person.user_id}`)
      .then(r => setData(r.data))
      .catch(() => setData({ events: [], story: '' }))
  }, [person.user_id])

  // Tempo real: outro aparelho mexeu na jornada → recarrega em silêncio, a
  // não ser que esta pessoa esteja editando agora (não atropela o que ela digita).
  useLiveRefresh(['journey'], () => {
    if (editingStory || milestoneModal) return
    api.get(`/journey/${person.user_id}`).then(r => setData(r.data)).catch(() => {})
  })

  const onMilestoneSaved = saved => {
    setData(d => {
      const exists = d.events.some(e => e.id === saved.id)
      const events = exists ? d.events.map(e => e.id === saved.id ? saved : e) : [...d.events, saved]
      return { ...d, events: events.sort((a, b) => a.event_date.localeCompare(b.event_date)) }
    })
    setMilestoneModal(null)
  }

  const removeMilestone = async ev => {
    const ok = await confirmDialog(`Excluir o marco "${ev.title}"?`, { title: 'Excluir marco' })
    if (!ok) return
    try {
      await api.delete(`/journey/events/${ev.id}`)
      setData(d => ({ ...d, events: d.events.filter(e => e.id !== ev.id) }))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  const saveStory = async () => {
    setSavingStory(true)
    try {
      await api.put(`/journey/${person.user_id}/story`, { story: storyDraft })
      setData(d => ({ ...d, story: storyDraft.trim() }))
      setEditingStory(false)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao salvar a história.', { title: 'Erro', danger: true })
    } finally {
      setSavingStory(false)
    }
  }

  if (!data) return <div className={s.detailLoading}>Carregando jornada...</div>

  return (
    <div className={s.detail}>
      <div className={s.sectionHead}>
        <span className={s.sectionTitle}>Linha do tempo</span>
        {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setMilestoneModal({})}>+ Marco</button>}
      </div>

      {data.events.length === 0 ? (
        <p className={s.empty}>Nenhum marco registrado ainda{canEdit ? ' — clique em "+ Marco" pra começar.' : '.'}</p>
      ) : (
        <div className={s.timelineScroll}>
          <ol className={s.timeline}>
            {data.events.map(ev => (
              <li key={ev.id} className={s.milestone}>
                <span className={s.mDate} title={fullDate(ev.event_date)}>{monthYear(ev.event_date)}</span>
                <span className={s.mRail}><span className={s.mDot} /><span className={s.mLine} /></span>
                <span className={s.mTitle}>{ev.title}</span>
                {ev.description && <span className={s.mDesc}>{ev.description}</span>}
                {canEdit && (
                  <span className={s.mActions}>
                    <button title="Editar" onClick={() => setMilestoneModal(ev)}>✏️</button>
                    <button title="Excluir" onClick={() => removeMilestone(ev)}>🗑️</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={s.sectionHead} style={{ marginTop: 22 }}>
        <span className={s.sectionTitle}>História</span>
        {canEdit && !editingStory && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setStoryDraft(data.story); setEditingStory(true) }}>✏️ Editar</button>
        )}
      </div>
      {editingStory ? (
        <div className={s.storyEdit}>
          <textarea rows={8} autoFocus value={storyDraft} onChange={e => setStoryDraft(e.target.value)} placeholder="Conte a história dessa pessoa na empresa..." />
          <div className={s.storyBtns}>
            <button className="btn btn-primary btn-sm" disabled={savingStory} onClick={saveStory}>{savingStory ? 'Salvando...' : 'Salvar'}</button>
            <button className="btn btn-ghost btn-sm" disabled={savingStory} onClick={() => setEditingStory(false)}>Cancelar</button>
          </div>
        </div>
      ) : data.story ? (
        <p className={s.story}>{data.story}</p>
      ) : (
        <p className={s.empty}>Ainda não escreveram a história de {person.user_name.split(' ')[0]}.</p>
      )}

      {milestoneModal && (
        <MilestoneModal
          userId={person.user_id}
          milestone={milestoneModal.id ? milestoneModal : null}
          onClose={() => setMilestoneModal(null)}
          onSaved={onMilestoneSaved}
        />
      )}
    </div>
  )
}

export default function JourneyPage() {
  const { user } = useAuthStore()
  const [people, setPeople] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const topRef = useRef(null)
  const canEdit = user?.system_role === 'super_admin'

  useEffect(() => {
    api.get('/journey/members')
      .then(r => {
        const list = r.data || []
        setPeople(list)
        // Abre a própria jornada se a pessoa estiver no quadro; senão a primeira.
        setSelectedId((list.find(p => p.user_id === user?.id) || list[0])?.user_id || null)
      })
      .catch(() => setPeople([]))
  }, [])

  const select = id => {
    setSelectedId(id)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const load = (keepSelected = true) =>
    api.get('/journey/members').then(r => {
      const list = r.data || []
      setPeople(list)
      setSelectedId(cur => (keepSelected && list.some(p => p.user_id === cur)) ? cur : (list.find(p => p.user_id === user?.id) || list[0])?.user_id || null)
    })

  useLiveRefresh(['journey'], () => { load().catch(() => {}) }) // lista de pessoas mudou em outro aparelho

  const addPerson = async u => {
    setShowPicker(false)
    try {
      await api.post('/journey/members', { user_id: u.id })
      await load()
      setSelectedId(u.id)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao adicionar.', { title: 'Erro', danger: true })
    }
  }

  const removePerson = async p => {
    const ok = await confirmDialog(`Tirar "${p.user_name}" da Jornada? Os marcos e a história ficam guardados caso volte.`, { title: 'Remover da Jornada' })
    if (!ok) return
    try {
      await api.delete(`/journey/members/${p.user_id}`)
      await load()
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true })
    }
  }

  if (!people) return <div className={s.loading}>Carregando...</div>

  const selected = people.find(p => p.user_id === selectedId)
  const others = people.filter(p => p.user_id !== selectedId)

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Jornada</h1>
          <p className={s.sub}>A trajetória de cada pessoa do time dentro da empresa. Clique em um avatar pra abrir.</p>
        </div>
        {canEdit && (
          <div className={s.addWrap}>
            <button className="btn btn-primary" onClick={() => setShowPicker(v => !v)}>+ Adicionar pessoa</button>
            {showPicker && (
              <MemberPicker align="right" existingIds={people.map(p => p.user_id)} onPick={addPerson} onClose={() => setShowPicker(false)} />
            )}
          </div>
        )}
      </div>

      {people.length === 0 ? (
        <div className={s.emptyBox}>
          <h3>Ninguém no time ainda</h3>
          <p>As pessoas são as mesmas do quadro de Desempenho — peça pra um Super Admin adicionar colaboradores lá.</p>
        </div>
      ) : (
        <>
          <div ref={topRef} />
          {selected && (
            <section className={s.selectedRow}>
              <div className={s.who}>
                <Avatar id={selected.user_id} name={selected.user_name} photo={selected.user_avatar} size={72} />
                <span className={s.whoName}>{selected.user_name}</span>
                {canEdit && <button className={s.removeLink} onClick={() => removePerson(selected)}>Tirar da Jornada</button>}
              </div>
              <div className={s.divider} />
              <Detail person={selected} canEdit={canEdit} />
            </section>
          )}

          {others.length > 0 && (
            <>
              <div className={s.othersTitle}>Outras pessoas</div>
              <div className={s.othersGrid}>
                {others.map(p => (
                  <div key={p.user_id} className={s.otherWrap}>
                    <button type="button" className={s.otherCard} onClick={() => select(p.user_id)}>
                      <Avatar id={p.user_id} name={p.user_name} photo={p.user_avatar} size={48} />
                      <span className={s.otherName}>{p.user_name}</span>
                      <span className={s.otherMeta}>{p.events_count ? `${p.events_count} marco${p.events_count > 1 ? 's' : ''}` : 'sem marcos ainda'}</span>
                    </button>
                    {canEdit && <button className={s.removeBtn} title="Tirar da Jornada" onClick={() => removePerson(p)}>✕</button>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
