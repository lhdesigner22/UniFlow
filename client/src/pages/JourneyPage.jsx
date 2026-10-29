import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import Avatar from '../components/common/Avatar'
import MemberPicker from '../components/common/MemberPicker'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './JourneyPage.module.css'

// "jan", "fev"... (sem ponto) e "fevereiro de 2022" — meses em minúscula, como no português
function monthShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}
function monthLong(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
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
    <Modal title={milestone ? 'Editar marco' : 'Novo marco'} onClose={onClose} width={440}>
      <div className="form-group">
        <label htmlFor="journey-data" className="label">Data</label>
        <input id="journey-data" type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
      </div>
      <div className="form-group">
        <label htmlFor="journey-titulo" className="label">Título</label>
        <input id="journey-titulo" autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Entrou na empresa, Promovido a Analista..." />
      </div>
      <div className="form-group">
        <label htmlFor="journey-detalhes-opcional" className="label">Detalhes (opcional)</label>
        <textarea id="journey-detalhes-opcional" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.title.trim() || !form.event_date || saving} onClick={save}>
        {saving ? 'Salvando...' : milestone ? 'Salvar alterações' : 'Adicionar marco'}
      </button>
    </Modal>
  )
}

// onCountChanged: avisa a página para recontar os marcos das fichas do topo
function Detail({ person, canEdit, onRemove, onCountChanged }) {
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
    onCountChanged()
  }

  const removeMilestone = async ev => {
    const ok = await confirmDialog(`Excluir o marco "${ev.title}"?`, { title: 'Excluir marco' })
    if (!ok) return
    try {
      await api.delete(`/journey/events/${ev.id}`)
      setData(d => ({ ...d, events: d.events.filter(e => e.id !== ev.id) }))
      onCountChanged()
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

  // marcos agrupados por ano (o ano é o "capítulo" da linha do tempo)
  const years = useMemo(() => {
    const map = new Map()
    for (const ev of data?.events || []) {
      const y = ev.event_date.slice(0, 4)
      if (!map.has(y)) map.set(y, [])
      map.get(y).push(ev)
    }
    return [...map.entries()]
  }, [data])

  const first = data?.events?.[0]
  const firstName = person.user_name.split(' ')[0]

  return (
    <section className={s.person} aria-labelledby="journey-person">
      <header className={s.personHead}>
        <Avatar id={person.user_id} name={person.user_name} photo={person.user_avatar} size={56} />
        <div className={s.personText}>
          <h2 id="journey-person" className={s.personName}>{person.user_name}</h2>
          <p className={s.personSummary}>
            {!data ? 'Carregando...'
              : first ? `${data.events.length} ${data.events.length === 1 ? 'marco' : 'marcos'} desde ${monthLong(first.event_date)}.`
              : 'Nenhum marco registrado ainda.'}
          </p>
        </div>
        {canEdit && (
          <RowMenu name={person.user_name} items={[
            { label: 'Tirar da Jornada', hint: 'Os marcos e a história ficam guardados', icon: 'trash', danger: true, onClick: () => onRemove(person) },
          ]} />
        )}
      </header>

      {!data ? <div className={s.detailLoading}>Carregando jornada...</div> : (
        <div className={s.columns}>
          <div className={s.col}>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Linha do tempo</h3>
              {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setMilestoneModal({})}><LineIcon name="plus" size={14} /> Marco</button>}
            </div>
            {years.length === 0 ? (
              <p className={s.empty}>{canEdit ? 'Comece pelo primeiro marco, por exemplo o dia em que a pessoa entrou na equipe.' : 'Nenhum marco registrado ainda.'}</p>
            ) : (
              <ol className={s.years}>
                {years.map(([year, evs]) => (
                  <li key={year} className={s.year}>
                    <span className={s.yearLabel}>{year}</span>
                    <ol className={s.milestones}>
                      {evs.map(ev => (
                        <li key={ev.id} className={s.milestone}>
                          <span className={s.mDot} aria-hidden="true" />
                          <span className={s.mDate} title={fullDate(ev.event_date)}>{monthShort(ev.event_date)}</span>
                          <div className={s.mBody}>
                            <span className={s.mTitle}>{ev.title}</span>
                            {ev.description && <span className={s.mDesc}>{ev.description}</span>}
                          </div>
                          {canEdit && (
                            <span className={s.mActions}>
                              <button aria-label={`Editar o marco ${ev.title}`} title="Editar" onClick={() => setMilestoneModal(ev)}><LineIcon name="edit" size={14} /></button>
                              <button aria-label={`Excluir o marco ${ev.title}`} title="Excluir" className={s.danger} onClick={() => removeMilestone(ev)}><LineIcon name="trash" size={14} /></button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={s.col}>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>História</h3>
              {canEdit && !editingStory && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setStoryDraft(data.story); setEditingStory(true) }}><LineIcon name="edit" size={14} /> {data.story ? 'Editar' : 'Escrever'}</button>
              )}
            </div>
            {editingStory ? (
              <div className={s.storyEdit}>
                <label htmlFor="journey-story" className="sr-only">História de {person.user_name}</label>
                <textarea id="journey-story" rows={10} autoFocus value={storyDraft} onChange={e => setStoryDraft(e.target.value)} placeholder={`Conte a história de ${firstName} na equipe...`} />
                <div className={s.storyBtns}>
                  <button className="btn btn-primary btn-sm" disabled={savingStory} onClick={saveStory}>{savingStory ? 'Salvando...' : 'Salvar história'}</button>
                  <button className="btn btn-ghost btn-sm" disabled={savingStory} onClick={() => setEditingStory(false)}>Cancelar</button>
                </div>
              </div>
            ) : data.story ? (
              <p className={s.story}>{data.story}</p>
            ) : (
              <p className={s.empty}>Ainda não escreveram a história de {firstName}.</p>
            )}
          </div>
        </div>
      )}

      {milestoneModal && (
        <MilestoneModal
          userId={person.user_id}
          milestone={milestoneModal.id ? milestoneModal : null}
          onClose={() => setMilestoneModal(null)}
          onSaved={onMilestoneSaved}
        />
      )}
    </section>
  )
}

export default function JourneyPage() {
  const { user } = useAuthStore()
  const [people, setPeople] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
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
    const ok = await confirmDialog(`Tirar "${p.user_name}" da Jornada? Os marcos e a história ficam guardados caso volte.`, { title: 'Tirar da Jornada' })
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

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Jornada</h1>
          <p className={s.sub}>A trajetória de cada pessoa da equipe: os marcos, ano a ano, e a história contada.</p>
        </div>
        {canEdit && (
          <div className={s.addWrap}>
            <button className="btn btn-primary" onClick={() => setShowPicker(v => !v)}><LineIcon name="plus" size={15} /> Adicionar pessoa</button>
            {showPicker && (
              <MemberPicker align="right" existingIds={people.map(p => p.user_id)} onPick={addPerson} onClose={() => setShowPicker(false)} />
            )}
          </div>
        )}
      </div>

      {people.length === 0 ? (
        <div className={s.emptyBox}>
          <h2>Ninguém na Jornada ainda</h2>
          <p>{canEdit ? 'Use "Adicionar pessoa" para começar pela primeira pessoa da equipe.' : 'Peça para um Super Admin adicionar a equipe aqui.'}</p>
        </div>
      ) : (
        <>
          <nav className={s.people} aria-label="Pessoas">
            {people.map(p => (
              <button key={p.user_id} type="button" aria-current={p.user_id === selectedId ? 'true' : undefined}
                className={`${s.chip} ${p.user_id === selectedId ? s.chipOn : ''}`} onClick={() => setSelectedId(p.user_id)}>
                <Avatar id={p.user_id} name={p.user_name} photo={p.user_avatar} size={26} />
                <span className={s.chipName}>{p.user_name}</span>
                <span className={s.chipCount}>{p.events_count || 0}</span>
              </button>
            ))}
          </nav>
          {selected && <Detail key={selected.user_id} person={selected} canEdit={canEdit} onRemove={removePerson} onCountChanged={() => load().catch(() => {})} />}
        </>
      )}
    </div>
  )
}
