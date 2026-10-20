import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import InventoryPicker from '../components/common/InventoryPicker'
import { isAllowedLoanEmail, LOAN_EMAIL_ERROR } from '../utils/loanEmail'
import s from './EquipmentLoansPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'

const STATUSES = [
  { key: 'aguardando_devolucao', label: 'Aguardando devolução' },
  { key: 'devolvido', label: 'Devolvido' },
  { key: 'uso_permanente', label: 'Uso Permanente' },
]

const BUILDINGS = [
  { key: 'sede', label: 'SEDE' },
  { key: 'centro', label: 'CENTRO' },
  { key: 'g5', label: 'G5' },
]
const BUILDING_MAP = Object.fromEntries(BUILDINGS.map(b => [b.key, b]))

// Mesma lista de equipamentos da planilha original — só sugestão (datalist),
// o campo aceita qualquer texto.
const EQUIPMENT_SUGGESTIONS = [
  'Chromebook', 'Controle do projetor', 'Caixa de som', 'Microfone/Base', 'Mouse', 'Teclado',
  'Monitor', 'Extensão', 'HDMI', 'Carregador Notebook', 'Pilha Palito', 'Headset', 'Adaptador',
  'Controle LG', 'Controle Ar Condicionado', 'Carregador de Chromebook', 'Suporte De Notebook',
  'Cabo de Força', 'Etiquetadora', 'WebCam', 'Notebook', 'Câmeras', 'Controle TV',
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(v) {
  if (!v) return '—'
  return v.slice(0, 10).split('-').reverse().join('/')
}

// A grade de horários não expõe hora exata, mas o código da turma segue um
// padrão comum nas faculdades (ex: "EPR.6NA" = número 6, M/T/N de
// Matutino/Vespertino(Tarde)/Noturno, letra da turma) — dá pra inferir o
// turno a partir disso, o suficiente pra diferenciar "de manhã" de "à noite"
// quando a sala tem mais de um professor no mesmo dia.
const TURNO_LABEL = { M: 'Manhã', T: 'Tarde', N: 'Noite' }
function inferTurno(code) {
  const m = /\d(M|T|N)[A-Z]?(_|$)/.exec(code || '')
  return m ? TURNO_LABEL[m[1]] : null
}

// Agrupa as entradas do dia por professor (uma pessoa pode aparecer em mais
// de um horário) juntando os turnos que ela dá aula naquele dia.
function groupByProfessor(entries) {
  const map = new Map()
  for (const e of entries) {
    if (!e.professor_name) continue
    const turno = inferTurno(e.class_code)
    if (!map.has(e.professor_name)) map.set(e.professor_name, new Set())
    if (turno) map.get(e.professor_name).add(turno)
  }
  return [...map.entries()].map(([professor, turnos]) => ({ professor, turnos: [...turnos] }))
}

function Editor({ loan, defaultBuilding, onClose, onSaved }) {
  const [form, setForm] = useState({
    requester_name: loan?.requester_name || '',
    requester_email: loan?.requester_email || '',
    equipment_model: loan?.equipment_model || '',
    patrimony: loan?.patrimony || '',
    equipment_inventory_id: loan?.equipment_inventory_id || null,
    building: loan?.building || defaultBuilding || 'sede',
    location: loan?.location || '',
    loan_date: loan?.loan_date?.slice(0, 10) || todayISO(),
    notes: loan?.notes || '',
    department_id: loan ? loan.department_id : defaultDepartment(),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInventoryPicker, setShowInventoryPicker] = useState(false)
  // Outros equipamentos da mesma reserva (só ao criar) — ex: professor que
  // leva vários Chromebooks. Cada um vira um empréstimo próprio no servidor.
  // Aviso de prazo de devolução por e-mail ao solicitante (só ao criar):
  // manhã (até 10h) ou noite (até 22h) — o padrão segue a hora de agora.
  // Só e-mail de colaborador/professor vale (não @a.fecaf.com.br, de aluno). Num
  // empréstimo antigo, um e-mail que já estava salvo e não foi mexido não trava.
  const emailTrimmed = form.requester_email.trim()
  const emailInvalid = !!emailTrimmed && !isAllowedLoanEmail(emailTrimmed) && emailTrimmed !== (loan?.requester_email || '')
  const canSendEmail = !!emailTrimmed && isAllowedLoanEmail(emailTrimmed)
  const [sendEmail, setSendEmail] = useState(true)
  const [deadlinePeriod, setDeadlinePeriod] = useState(() => new Date().getHours() < 12 ? 'manha' : 'noite')
  const [extras, setExtras] = useState([]) // [{ key, equipment_model, patrimony, equipment_inventory_id }]
  const [extraPickerKey, setExtraPickerKey] = useState(null)
  const addExtra = () => setExtras(list => [...list, {
    key: Math.random().toString(36).slice(2), equipment_model: form.equipment_model, patrimony: '', equipment_inventory_id: null,
  }])
  const patchExtra = (key, patch) => setExtras(list => list.map(x => x.key === key ? { ...x, ...patch } : x))
  const pickedInventoryIds = [form.equipment_inventory_id, ...extras.map(x => x.equipment_inventory_id)].filter(Boolean)
  const [roomNames, setRoomNames] = useState([])
  const [roomLookup, setRoomLookup] = useState(null) // { room, entries } | null

  // Nomes de sala já sincronizados da grade de horários (ver
  // roomSchedule.js) — usados só pra sugerir no datalist e achar a sala
  // batendo com o que a pessoa digitou.
  useEffect(() => {
    api.get('/room-schedule/rooms', { params: { building: form.building } })
      .then(r => setRoomNames(r.data || []))
      .catch(() => setRoomNames([]))
  }, [form.building])

  // Ao digitar/escolher a sala, acha o nome mais parecido na grade
  // sincronizada e busca quem está alocado nela hoje.
  useEffect(() => {
    const term = form.location.trim().toLowerCase()
    if (term.length < 3) { setRoomLookup(null); return }
    const matched = roomNames.find(r => r.toLowerCase().includes(term)) || roomNames.find(r => term.includes(r.toLowerCase()))
    if (!matched) { setRoomLookup(null); return }
    const t = setTimeout(() => {
      api.get('/room-schedule', { params: { building: form.building, room: matched } })
        .then(r => {
          const entries = r.data || []
          setRoomLookup({ room: matched, entries })
          // Preenche o nome do solicitante sozinho quando só tem 1 professor
          // na sala hoje e o campo ainda está vazio — com mais de um, deixa
          // a pessoa escolher (aparece na dica embaixo do campo).
          const profs = [...new Set(entries.filter(e => e.professor_name).map(e => e.professor_name))]
          if (profs.length === 1) {
            setForm(f => f.requester_name.trim() ? f : { ...f, requester_name: profs[0] })
          }
        })
        .catch(() => setRoomLookup(null))
    }, 300)
    return () => clearTimeout(t)
  }, [form.location, roomNames, form.building])

  // Busca o e-mail no diretório do Google Workspace pelo nome do
  // solicitante (mesma busca do Gmail/Contatos, ver directory.js) — só
  // preenche sozinho se o campo de e-mail ainda estiver vazio, e não
  // sobrescreve se a pessoa já digitou um e-mail manualmente.
  const [emailLookup, setEmailLookup] = useState(null) // 'loading' | 'not_found' | null
  useEffect(() => {
    const name = form.requester_name.trim()
    if (form.requester_email.trim() || name.length < 4) { setEmailLookup(null); return }
    setEmailLookup('loading')
    const t = setTimeout(() => {
      api.get('/directory/lookup', { params: { name } })
        .then(r => {
          if (r.data?.email) {
            setForm(f => f.requester_email.trim() ? f : { ...f, requester_email: r.data.email })
            setEmailLookup(null)
          } else {
            setEmailLookup('not_found')
          }
        })
        .catch(() => setEmailLookup('not_found'))
    }, 400)
    return () => clearTimeout(t)
  }, [form.requester_name])

  const pickFromInventory = item => {
    setForm(f => ({
      ...f,
      equipment_model: f.equipment_model.trim() || item.equipment_model,
      patrimony: [item.variant, item.patrimony ? `#${item.patrimony}` : ''].filter(Boolean).join(' '),
      equipment_inventory_id: item.id,
    }))
    setShowInventoryPicker(false)
  }

  const save = async () => {
    if (!form.requester_name.trim() || !form.equipment_model.trim()) return
    setSaving(true)
    setError('')
    try {
      if (loan) {
        onSaved((await api.put(`/equipment-loans/${loan.id}`, form)).data)
      } else {
        const extra_items = extras.map(({ equipment_model, patrimony, equipment_inventory_id }) => ({ equipment_model, patrimony, equipment_inventory_id }))
        const { extras: created = [], ...first } = (await api.post('/equipment-loans', {
          ...form, extra_items, send_email: sendEmail && canSendEmail, deadline_period: deadlinePeriod,
        })).data
        created.forEach(onSaved)
        onSaved(first)
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={loan ? 'Editar empréstimo' : 'Novo empréstimo de equipamento'} onClose={onClose} width={520}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Nome do solicitante</label>
          <input autoFocus value={form.requester_name} onChange={e => setForm(f => ({ ...f, requester_name: e.target.value }))} placeholder="Ex: Maria Silva" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Data do empréstimo</label>
          <input type="date" value={form.loan_date} onChange={e => setForm(f => ({ ...f, loan_date: e.target.value }))} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Email (opcional)</label>
        <input type="email" value={form.requester_email} onChange={e => setForm(f => ({ ...f, requester_email: e.target.value }))} placeholder="nome@colegioser.com" />
        {emailInvalid && <p className={s.fileError}>{LOAN_EMAIL_ERROR}</p>}
        {emailLookup === 'loading' && <p className={s.roomHint}>🔎 Buscando e-mail no diretório...</p>}
        {emailLookup === 'not_found' && <p className={s.roomHint}>Não achei esse nome no diretório — preenche manual.</p>}
        {!loan && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 13, opacity: canSendEmail ? 1 : 0.5 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox" style={{ width: 'auto' }}
                checked={sendEmail && canSendEmail}
                disabled={!canSendEmail}
                onChange={e => setSendEmail(e.target.checked)}
              />
              Enviar e-mail com o prazo de devolução
            </label>
            <select
              style={{ width: 'auto' }}
              value={deadlinePeriod}
              disabled={!canSendEmail || !sendEmail}
              onChange={e => setDeadlinePeriod(e.target.value)}
            >
              <option value="manha">Manhã (devolver até 10h)</option>
              <option value="noite">Noite (devolver até 22h)</option>
            </select>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Equipamento</label>
          <input
            list="equipment-loan-model-list"
            value={form.equipment_model}
            onChange={e => setForm(f => ({ ...f, equipment_model: e.target.value }))}
            placeholder="Ex: Chromebook"
          />
          <datalist id="equipment-loan-model-list">
            {EQUIPMENT_SUGGESTIONS.map(m => <option key={m} value={m} />)}
          </datalist>
        </div>
        <div className="form-group" style={{ flex: 1, position: 'relative' }}>
          <label className="label">Patrimônio (opcional)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={form.patrimony}
              onChange={e => setForm(f => ({ ...f, patrimony: e.target.value, equipment_inventory_id: null }))}
              placeholder="Ex: 5028"
            />
            <button type="button" className="btn btn-ghost btn-sm" title="Escolher do inventário" onClick={() => setShowInventoryPicker(v => !v)}>📋</button>
          </div>
          {showInventoryPicker && (
            <InventoryPicker building={form.building} excludeIds={pickedInventoryIds} onPick={pickFromInventory} onClose={() => setShowInventoryPicker(false)} />
          )}
        </div>
      </div>
      {!loan && (
        <>
          {extras.map(x => (
            <div key={x.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <input
                  list="equipment-loan-model-list"
                  value={x.equipment_model}
                  onChange={e => patchExtra(x.key, { equipment_model: e.target.value })}
                  placeholder="Equipamento"
                />
              </div>
              <div className="form-group" style={{ flex: 1, position: 'relative' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={x.patrimony}
                    onChange={e => patchExtra(x.key, { patrimony: e.target.value, equipment_inventory_id: null })}
                    placeholder="Patrimônio"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" title="Escolher do inventário" onClick={() => setExtraPickerKey(k => k === x.key ? null : x.key)}>📋</button>
                  <button type="button" className="btn btn-ghost btn-sm" title="Remover este equipamento" onClick={() => setExtras(list => list.filter(y => y.key !== x.key))}>✕</button>
                </div>
                {extraPickerKey === x.key && (
                  <InventoryPicker
                    building={form.building}
                    excludeIds={pickedInventoryIds}
                    onClose={() => setExtraPickerKey(null)}
                    onPick={item => {
                      patchExtra(x.key, {
                        equipment_model: x.equipment_model.trim() || item.equipment_model,
                        patrimony: [item.variant, item.patrimony ? `#${item.patrimony}` : ''].filter(Boolean).join(' '),
                        equipment_inventory_id: item.id,
                      })
                      setExtraPickerKey(null)
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="form-group">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addExtra}>
              ➕ Adicionar outro equipamento
            </button>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Prédio</label>
          <select value={form.building} onChange={e => setForm(f => ({ ...f, building: e.target.value }))}>
            {BUILDINGS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="label">Sala / Localidade (opcional)</label>
          <input
            list="equipment-loan-room-list"
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            placeholder="Ex: Sala 510, Auditório 2..."
          />
          <datalist id="equipment-loan-room-list">
            {roomNames.map(r => <option key={r} value={r} />)}
          </datalist>
          {roomLookup && (() => {
            const profs = groupByProfessor(roomLookup.entries)
            return profs.length === 0 ? (
              <p className={s.roomHint}>
                📅 {roomLookup.room}: {roomLookup.entries.length === 0
                  ? 'a grade sincronizada não tem dados de hoje (pode estar desatualizada — peça pra atualizar).'
                  : 'sem aula hoje.'}
              </p>
            ) : (
              <div className={s.roomProfList}>
                <p className={s.roomHint}>🧑‍🏫 {roomLookup.room} hoje — clique pra usar:</p>
                {profs.map(({ professor, turnos }) => (
                  <button
                    key={professor}
                    type="button"
                    className={s.roomProfBtn}
                    onClick={() => setForm(f => ({ ...f, requester_name: professor }))}
                  >
                    {turnos.length > 0 && <span className={s.roomProfTurno}>{turnos.join(' / ')}</span>}
                    {professor}
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
      <div className="form-group">
        <label className="label">Observação (opcional)</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Detalhes, condição do equipamento..." />
      </div>
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />

      {error && <p className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.requester_name.trim() || !form.equipment_model.trim() || extras.some(x => !x.equipment_model.trim()) || emailInvalid || saving}
        onClick={save}
      >
        {saving ? 'Salvando...' : loan ? 'Salvar' : extras.length ? `Registrar ${extras.length + 1} equipamentos` : 'Registrar empréstimo'}
      </button>
    </Modal>
  )
}

// Resposta por e-mail que ninguém abriu ainda (bolinha vermelha no ✉️).
// As duas datas vêm do servidor no mesmo formato ('YYYY-MM-DD HH:MM:SS', UTC).
const hasNewReply = l => !!l.last_reply_at && (!l.replies_seen_at || l.last_reply_at > l.replies_seen_at)

const QUICK_MESSAGES = [
  'Lembrete: por favor, devolva o equipamento à T.I. assim que possível.',
  'O prazo de devolução do equipamento já passou. Pode devolver hoje, por favor?',
  'Recebemos o equipamento de volta. Obrigado!',
]

// Mensagem rápida por e-mail ao solicitante, com o histórico do que já foi
// enviado pra esse empréstimo (visual de chat). Se o empréstimo não tem
// e-mail, pede um — e ele fica guardado no empréstimo.
function MessageModal({ loan, onClose, onEmailSaved }) {
  const [message, setMessage] = useState('')
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)

  // Abre na hora com o que já está salvo e, em seguida, pede pro servidor
  // procurar respostas novas na caixa do Gmail (`check=1`, alguns segundos).
  const loadHistory = (check = false) => api.get(`/equipment-loans/${loan.id}/messages`, { params: check ? { check: 1 } : {} })
    .then(r => setHistory(r.data || [])).catch(() => setHistory(h => h || []))
  useEffect(() => { loadHistory().then(() => loadHistory(true)) }, [loan.id])
  // Resposta que chegou com o chat aberto (o servidor checa a caixa a cada 5 min).
  useLiveRefresh(['equipment-loans'], () => loadHistory())

  // E-mail guardado só vale se for de colaborador/professor — conta de aluno
  // (@a.fecaf.com.br) não recebe; aí pede um válido.
  const hasEmail = isAllowedLoanEmail(loan.requester_email)
  const target = hasEmail ? loan.requester_email : to.trim()
  const toInvalid = !hasEmail && !!target && !isAllowedLoanEmail(target)

  const send = async () => {
    if (!message.trim() || !target || toInvalid || (!hasEmail && !isAllowedLoanEmail(target))) return
    setSending(true)
    setError('')
    try {
      await api.post(`/equipment-loans/${loan.id}/message`, { message, to: hasEmail ? undefined : target })
      if (!hasEmail) onEmailSaved(loan.id, target)
      setMessage('')
      await loadHistory()
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao enviar. Tenta de novo?')
      loadHistory()
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title={`Mensagem rápida — ${loan.requester_name}`} onClose={onClose} width={520}>
      <p className={s.roomHint} style={{ marginBottom: 10 }}>
        {loan.equipment_model}{loan.patrimony ? ` (${loan.patrimony})` : ''} · enviada por e-mail em nome da T.I.
      </p>

      {history && history.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', gap: 8, marginBottom: 14 }}>
          {history.map(m => {
            const incoming = m.direction === 'in' // resposta do solicitante por e-mail
            return (
              <div key={m.id} style={{
                alignSelf: incoming ? 'flex-start' : 'flex-end', maxWidth: '88%', borderRadius: 10, padding: '8px 12px', fontSize: 13,
                background: incoming ? 'color-mix(in srgb, var(--brand) 14%, transparent)' : 'var(--surface-2)',
                border: m.status === 'failed' ? '1px solid var(--red, #EF4444)' : '1px solid transparent',
              }}>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.message}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {incoming ? `↩ ${loan.requester_name || m.from_email}` : (m.sent_by_name || '—')} · {new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {incoming ? ' · resposta por e-mail' : m.status === 'sent' ? ' · ✓ enviado' : m.status === 'failed' ? ' · ✗ falhou' : ' · enviando'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hasEmail ? (
        <p className={s.roomHint} style={{ marginBottom: 8 }}>Para: {loan.requester_email}</p>
      ) : (
        <div className="form-group">
          <label className="label">{loan.requester_email ? `E-mail válido do solicitante (${loan.requester_email} não é permitido)` : 'E-mail do solicitante (esse empréstimo não tem)'}</label>
          <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="nome@colegioser.com" />
          {toInvalid && <p className={s.fileError}>{LOAN_EMAIL_ERROR}</p>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {QUICK_MESSAGES.map(q => (
          <button key={q} type="button" className="btn btn-ghost btn-sm" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => setMessage(q)}>
            {q.length > 42 ? q.slice(0, 40) + '…' : q}
          </button>
        ))}
      </div>
      <div className="form-group">
        <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Escreva a mensagem ou escolha uma pronta acima..." autoFocus />
      </div>

      {error && <p className={s.fileError}>{error}</p>}
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!message.trim() || !target || toInvalid || sending}
        onClick={send}
      >
        {sending ? 'Enviando...' : '✉️ Enviar por e-mail'}
      </button>
    </Modal>
  )
}

// Gerenciar o inventário (catálogo de patrimônios conhecidos) de um prédio
// — só super_admin cadastra/edita/exclui, pra não virar bagunça; qualquer
// usuário já enxerga a lista através do InventoryPicker ao registrar um
// empréstimo.
function InventoryModal({ building, onClose }) {
  const [items, setItems] = useState(null)
  const [form, setForm] = useState({ equipment_model: 'Chromebook', variant: '', patrimony: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    api.get('/equipment-inventory', { params: { building } })
      .then(r => setItems(r.data || []))
      .catch(() => setItems([]))
  }
  useEffect(() => { load() }, [building])

  const add = async () => {
    if (!form.equipment_model.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.post('/equipment-inventory', { ...form, building })
      setForm(f => ({ ...f, variant: '', patrimony: '' }))
      load()
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao adicionar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  const remove = async item => {
    const ok = await confirmDialog(`Excluir "${item.equipment_model}${item.variant ? ' — ' + item.variant : ''} ${item.patrimony ? '#' + item.patrimony : ''}" do inventário?`, { title: 'Excluir item' })
    if (!ok) return
    try {
      await api.delete(`/equipment-inventory/${item.id}`)
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  return (
    <Modal title={`Inventário — ${BUILDING_MAP[building].label}`} onClose={onClose} width={480}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <label className="label">Equipamento</label>
          <input list="equipment-loan-model-list" value={form.equipment_model} onChange={e => setForm(f => ({ ...f, equipment_model: e.target.value }))} placeholder="Ex: Chromebook" />
          <datalist id="equipment-loan-model-list">
            {EQUIPMENT_SUGGESTIONS.map(m => <option key={m} value={m} />)}
          </datalist>
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="label">Variante</label>
          <input value={form.variant} onChange={e => setForm(f => ({ ...f, variant: e.target.value }))} placeholder="Ex: Samsung preto" />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 90, marginBottom: 0 }}>
          <label className="label">Patrimônio</label>
          <input value={form.patrimony} onChange={e => setForm(f => ({ ...f, patrimony: e.target.value }))} placeholder="Ex: 14602" />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!form.equipment_model.trim() || saving} onClick={add}>+ Adicionar</button>
      </div>
      {error && <p className={s.fileError}>{error}</p>}

      <div className={s.section}>
        {items === null ? (
          <p className={s.emptyHint}>Carregando...</p>
        ) : items.length === 0 ? (
          <p className={s.emptyHint}>Nenhum item cadastrado ainda.</p>
        ) : (
          <div className={s.historyList}>
            {items.map(i => (
              <div key={i.id} className={s.historyRow}>
                <div className={s.historyInfo}>
                  <span className={s.historyGiver}>{i.equipment_model}{i.variant ? ` — ${i.variant}` : ''}</span>
                  <span className={s.historyMeta}>
                    {i.patrimony ? `#${i.patrimony}` : 'sem patrimônio'}
                    {!!i.on_loan && ' · emprestado agora'}
                  </span>
                </div>
                <button className={s.iconBtn} title="Excluir" onClick={() => remove(i)}>🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function EquipmentLoansPage() {
  const { user } = useAuthStore()
  const { building: buildingParam } = useParams()
  const building = BUILDING_MAP[buildingParam] ? buildingParam : 'sede'
  const [loans, setLoans] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, item = editar
  const [showInventory, setShowInventory] = useState(false)
  // 'abertos' = padrão: esconde os já devolvidos (continuam no banco; é só
  // escolher 'Todas as situações' ou 'Devolvido' no filtro pra ver).
  const [statusFilter, setStatusFilter] = useState('abertos')
  const [search, setSearch] = useState('')

  // `silent` = recarga em segundo plano (tempo real): não mostra "carregando"
  // e, se falhar, mantém a lista que já está na tela.
  const load = ({ silent } = {}) => {
    if (!silent) setLoading(true)
    api.get('/equipment-loans', { params: { building } })
      .then(r => setLoans(r.data || []))
      .catch(() => { if (!silent) setLoans([]) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [building])
  useLiveRefresh(['equipment-loans'], () => load({ silent: true })) // outro aparelho registrou/devolveu algo

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (loans || []).filter(l => {
      if (statusFilter === 'abertos' ? l.status === 'devolvido' : (statusFilter && l.status !== statusFilter)) return false
      if (term && !`${l.requester_name} ${l.equipment_model} ${l.patrimony || ''} ${l.location || ''} ${l.author_name || ''}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [loans, statusFilter, search])

  // Os cartões de cima contam tudo do prédio (inclusive devolvidos), mesmo
  // com a lista escondendo os devolvidos.
  const totals = useMemo(() => {
    const all = loans || []
    const items = all.length
    const aguardando = all.filter(l => l.status === 'aguardando_devolucao').length
    const devolvido = all.filter(l => l.status === 'devolvido').length
    const permanente = all.filter(l => l.status === 'uso_permanente').length
    return { items, aguardando, devolvido, permanente }
  }, [loans])

  const onSaved = saved => {
    setLoans(prev => {
      const exists = (prev || []).some(l => l.id === saved.id)
      return exists ? prev.map(l => l.id === saved.id ? saved : l) : [saved, ...(prev || [])]
    })
    setEditing(null)
  }

  const changeStatus = async (row, status) => {
    setLoans(prev => prev.map(l => l.id === row.id ? { ...l, status } : l))
    try {
      const { data } = await api.post(`/equipment-loans/${row.id}/status`, { status })
      setLoans(prev => prev.map(l => l.id === row.id ? data : l))
    } catch (e) {
      setLoans(prev => prev.map(l => l.id === row.id ? { ...l, status: row.status } : l))
      await alertDialog(e.response?.data?.error || 'Erro ao atualizar situação.', { title: 'Erro', danger: true })
    }
  }

  const deleteLoan = async l => {
    const ok = await confirmDialog(`Excluir o empréstimo de "${l.equipment_model}" pra ${l.requester_name}?`, { title: 'Excluir empréstimo' })
    if (!ok) return
    try {
      await api.delete(`/equipment-loans/${l.id}`)
      setLoans(prev => (prev || []).filter(x => x.id !== l.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  const [messaging, setMessaging] = useState(null) // empréstimo cujo ✉️ está aberto
  const [syncingRooms, setSyncingRooms] = useState(false)
  const syncRoomSchedule = async () => {
    setSyncingRooms(true)
    try {
      const { data } = await api.post('/room-schedule/sync', {}, { timeout: 120_000 })
      await alertDialog(`Grade atualizada: ${data.rows} registros (${data.days[0].split('-').reverse().join('/')} a ${data.days[data.days.length - 1].split('-').reverse().join('/')}).`, { title: 'Grade de salas' })
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao atualizar a grade.', { title: 'Erro', danger: true })
    } finally {
      setSyncingRooms(false)
    }
  }

  const writable = canEditModule(user, 'loans') // cargo que só VÊ os empréstimos não registra/altera
  const canEdit = l => writable && (l.created_by === user?.id || user?.system_role === 'super_admin')
  const exportCsv = () => downloadFile('/equipment-loans/export', 'emprestimo-equipamentos.csv')

  if (loading) return <div className={s.loading}>Carregando empréstimos...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Empréstimo de Equipamentos — {BUILDING_MAP[building].label}</h1>
          <p className={s.sub}>Chromebook, controle de projetor, caixa de som e outros itens emprestados — quem pegou, onde e a situação.</p>
        </div>
        <div className={s.headerRight}>
          {user?.system_role === 'super_admin' && (
            <>
              <button className="btn btn-ghost" disabled={syncingRooms} onClick={syncRoomSchedule}>
                {syncingRooms ? 'Atualizando grade...' : '🔄 Atualizar grade de salas'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowInventory(true)}>📋 Inventário</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={exportCsv}>⬇ Exportar CSV</button>
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo empréstimo</button>}
        </div>
      </div>

      <div className={s.kpiRow}>
        <div className={`${s.kpiCard} ${s.kpiTotal}`}>
          <span className={s.kpiNumber}>{totals.items}</span>
          <span className={s.kpiLabel}>Itens</span>
        </div>
        <div className={s.kpiCard}>
          <span className={s.kpiNumber}>{totals.aguardando}</span>
          <span className={s.kpiLabel}>Aguardando devolução</span>
        </div>
        <div className={`${s.kpiCard} ${s.kpiDone}`}>
          <span className={s.kpiNumber}>{totals.devolvido}</span>
          <span className={s.kpiLabel}>Devolvido</span>
        </div>
        <div className={s.kpiCard}>
          <span className={s.kpiNumber}>{totals.permanente}</span>
          <span className={s.kpiLabel}>Uso permanente</span>
        </div>
      </div>

      {(loans || []).length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum empréstimo em {BUILDING_MAP[building].label}</h3>
          <p>Registre o primeiro equipamento emprestado nesse prédio.</p>
        </div>
      ) : (
        <Reveal className={s.tableCard}>
          <div className={s.tableFilters}>
            <input
              className={s.searchInput}
              placeholder="Buscar por nome, equipamento, patrimônio, sala..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="abertos">Em aberto (sem devolvidos)</option>
              <option value="">Todas as situações</option>
              {STATUSES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
            </select>
            <span className={s.tableCount}>{filtered.length} item(ns)</span>
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Data</th><th>Solicitante</th><th>Equipamento</th>
                  <th>Patrimônio</th><th>Prédio</th><th>Sala / Localidade</th><th>Observação</th><th>Registrado por</th>
                  <th className={s.stickyStatus}>Situação</th><th className={s.stickyActions}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id}>
                    <td className={s.mono}>{fmtDate(l.loan_date)}</td>
                    <td className={s.itemCell}>
                      <span className={s.itemName} title={l.requester_name}>{l.requester_name}</span>
                      {l.requester_email && <span className={s.itemDesc} title={l.requester_email}>{l.requester_email}</span>}
                    </td>
                    <td className={s.itemCell}>
                      <span className={s.itemName} title={l.equipment_model}>{l.equipment_model}</span>
                    </td>
                    <td className={s.mono}>{l.patrimony || '—'}</td>
                    <td className={s.mono}>{BUILDING_MAP[l.building]?.label || l.building || '—'}</td>
                    <td className={s.descCell} title={l.location}>{l.location || '—'}</td>
                    <td className={s.descCell} title={l.notes}>{l.notes || '—'}</td>
                    <td className={s.itemCell}><span className={s.itemName} title={l.author_name}>{l.author_name || '—'}</span></td>
                    <td className={s.stickyStatus}>
                      <select
                        className={s.statusSelect}
                        disabled={!writable}
                        data-status={l.status}
                        value={l.status}
                        onChange={e => changeStatus(l, e.target.value)}
                      >
                        {STATUSES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
                      </select>
                    </td>
                    <td className={s.stickyActions}>
                      <div className={s.rowActions}>
                        <button
                          className={s.iconBtn} style={{ position: 'relative' }}
                          title={hasNewReply(l) ? 'O solicitante respondeu por e-mail — abrir conversa' : 'Enviar mensagem por e-mail ao solicitante'}
                          onClick={() => setMessaging(l)}
                        >
                          ✉️
                          {hasNewReply(l) && <span aria-label="resposta nova" style={{ position: 'absolute', top: 1, right: 1, width: 8, height: 8, borderRadius: '50%', background: 'var(--red, #EF4444)' }} />}
                        </button>
                        {canEdit(l) && <>
                          <button className={s.iconBtn} title="Editar" onClick={() => setEditing(l)}>✏️</button>
                          <button className={s.iconBtn} title="Excluir" onClick={() => deleteLoan(l)}>🗑️</button>
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className={s.chartEmpty}>{statusFilter === 'abertos' && !search.trim() ? 'Nenhum empréstimo em aberto — tudo foi devolvido.' : 'Nenhum empréstimo bate com esse filtro.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {editing && (
        <Editor
          loan={editing.id ? editing : null}
          defaultBuilding={building}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {messaging && (
        <MessageModal
          loan={messaging}
          onClose={() => {
            // Abrir o chat marca as respostas como vistas (o servidor também grava).
            setLoans(prev => prev.map(l => l.id === messaging.id ? { ...l, replies_seen_at: l.last_reply_at || l.replies_seen_at } : l))
            setMessaging(null)
          }}
          onEmailSaved={(id, email) => {
            setLoans(prev => prev.map(l => l.id === id ? { ...l, requester_email: email } : l))
            setMessaging(m => m && { ...m, requester_email: email })
          }}
        />
      )}

      {showInventory && (
        <InventoryModal building={building} onClose={() => setShowInventory(false)} />
      )}
    </div>
  )
}
