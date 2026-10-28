import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import s from './OrgChartPage.module.css'

function Editor({ node, defaultParentId, nodes, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: node?.name || '',
    role: node?.role || '',
    parent_id: node ? (node.parent_id || '') : (defaultParentId || ''),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Não pode virar filho de si mesmo (nem de nenhum dos próprios descendentes)
  const descendantIds = useMemo(() => {
    if (!node) return new Set()
    const ids = new Set([node.id])
    let changed = true
    while (changed) {
      changed = false
      for (const n of nodes) {
        if (n.parent_id && ids.has(n.parent_id) && !ids.has(n.id)) { ids.add(n.id); changed = true }
      }
    }
    return ids
  }, [node, nodes])

  const parentOptions = nodes.filter(n => !descendantIds.has(n.id))

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const payload = { name: form.name.trim(), role: form.role.trim() || null, parent_id: form.parent_id || null }
      const saved = node
        ? (await api.put(`/org-chart/${node.id}`, payload)).data
        : (await api.post('/org-chart', payload)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={node ? 'Editar cargo' : 'Novo cargo'} onClose={onClose} width={480}>
      <div className="form-group">
        <label htmlFor="org-chart-nome" className="label">Nome</label>
        <input id="org-chart-nome" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: João Paulo, ou só 'Estágio' pra vaga genérica" />
      </div>
      <div className="form-group">
        <label htmlFor="org-chart-cargo" className="label">Cargo</label>
        <input id="org-chart-cargo" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="Ex: Gerente TI, Analista, Auxiliar..." />
      </div>
      <div className="form-group">
        <label htmlFor="org-chart-reporta-para" className="label">Reporta para</label>
        <select id="org-chart-reporta-para" value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}>
          <option value="">— Nenhum (topo da hierarquia)</option>
          {parentOptions.map(n => <option key={n.id} value={n.id}>{n.name}{n.role ? ` — ${n.role}` : ''}</option>)}
        </select>
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

// Uma caixa — sem aninhamento (nada de <ul>/<li>): a posição vem inteira da
// fileira por nível em que o pai (OrgChartPage) a coloca, mais o
// deslocamento de arrastar por cima. As linhas de hierarquia são só o SVG
// (ver recomputeLines), então a caixa não precisa "morar dentro" do pai.
function NodeBox({ node, canEdit, onAddChild, onEdit, onDelete, onLinkClick, linkingFrom, registerNodeEl, onNodeMouseDown, draggingId, drawMode }) {
  const isLinking = linkingFrom === node.id
  const isDragging = draggingId === node.id
  const hasOffset = !!(node.offset_x || node.offset_y)
  const style = {
    transform: hasOffset ? `translate(${node.offset_x || 0}px, ${node.offset_y || 0}px)` : undefined,
    zIndex: isDragging ? 5 : undefined,
    cursor: drawMode ? 'crosshair' : canEdit ? (isDragging ? 'grabbing' : 'grab') : undefined,
  }

  // No modo "desenhar linha", o clique no corpo da caixa não deve arrastar
  // o cargo — deixa o evento subir até o canvas (.treeWrap), que começa uma
  // linha solta a partir desse ponto (dá pra "sair" de dentro de uma caixa).
  const handleMouseDown = e => {
    if (drawMode) return
    onNodeMouseDown(e, node)
  }

  return (
    <div
      ref={el => registerNodeEl(node.id, el)}
      style={style}
      className={`${s.node} ${isLinking ? s.nodeLinking : ''} ${isDragging ? s.nodeDragging : ''}`}
      onMouseDown={canEdit ? handleMouseDown : undefined}
    >
      <span className={s.nodeName}>{node.name}</span>
      {node.role && <span className={s.nodeRole}>{node.role}</span>}
      {canEdit && (
        <div className={s.nodeActions} onMouseDown={e => e.stopPropagation()}>
          <button title="Adicionar subordinado" onClick={() => onAddChild(node.id)}>+ Subordinado</button>
          <button title={isLinking ? 'Cancelar ligação' : 'Ligar a outro cargo (sem hierarquia)'} onClick={() => onLinkClick(node.id)}>
            {isLinking ? '✕ Ligando...' : '🔗 Ligar'}
          </button>
          <button title="Editar" onClick={() => onEdit(node)}>✏️</button>
          <button title="Excluir" onClick={() => onDelete(node)}>🗑️</button>
        </div>
      )}
    </div>
  )
}

export default function OrgChartPage() {
  const { user } = useAuthStore()
  const [nodes, setNodes] = useState(null)
  const [links, setLinks] = useState([])
  const [freeLines, setFreeLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null=fechado, {}=novo topo, {parent_id}=novo filho, node=editar
  const [linkingFrom, setLinkingFrom] = useState(null)
  const [linkError, setLinkError] = useState('')
  const [draggingId, setDraggingId] = useState(null)
  const [drawMode, setDrawMode] = useState(false)
  const [drawPreview, setDrawPreview] = useState(null)
  const drawStateRef = useRef(null)
  const canEdit = user?.system_role === 'super_admin'

  const wrapRef = useRef(null)
  const nodeElsRef = useRef({})
  const dragStateRef = useRef(null)
  const [svgLines, setSvgLines] = useState([])
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })

  const registerNodeEl = useCallback((id, el) => {
    if (el) nodeElsRef.current[id] = el
    else delete nodeElsRef.current[id]
  }, [])

  const load = ({ silent } = {}) => {
    Promise.all([api.get('/org-chart'), api.get('/org-chart/links'), api.get('/org-chart/free-lines')])
      .then(([n, l, f]) => { setNodes(n.data || []); setLinks(l.data || []); setFreeLines(f.data || []) })
      .catch(() => { if (!silent) { setNodes([]); setLinks([]); setFreeLines([]) } })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  // Tempo real: outro aparelho mexeu no organograma. Não recarrega no meio de
  // um arraste de caixa (ela "pularia" da mão da pessoa).
  useLiveRefresh(['org-chart'], () => { if (!dragStateRef.current) load({ silent: true }) })

  // Todas as linhas (hierarquia sólida + ligações soltas tracejadas) são
  // desenhadas num <svg> por cima da árvore, medindo a posição REAL de cada
  // caixa na tela — por isso arrastar uma caixa (transform) já move a linha
  // junto, sem precisar de nenhum cálculo extra além de rechamar isto.
  const recomputeLines = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    setSvgSize({ width: wrap.scrollWidth, height: wrap.scrollHeight })
    const wrapRect = wrap.getBoundingClientRect()

    const pairs = [
      ...(nodes || []).filter(n => n.parent_id).map(n => ({ id: `h-${n.id}`, from: n.parent_id, to: n.id, kind: 'hierarchy' })),
      ...links.map(l => ({ id: l.id, from: l.from_node_id, to: l.to_node_id, kind: 'link' })),
    ]

    const lines = pairs.map(p => {
      const a = nodeElsRef.current[p.from]
      const b = nodeElsRef.current[p.to]
      if (!a || !b) return null
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const aCenterX = ra.left + ra.width / 2 - wrapRect.left + wrap.scrollLeft
      const bCenterX = rb.left + rb.width / 2 - wrapRect.left + wrap.scrollLeft
      const aCenterY = ra.top + ra.height / 2 - wrapRect.top + wrap.scrollTop
      const bCenterY = rb.top + rb.height / 2 - wrapRect.top + wrap.scrollTop

      if (p.kind === 'hierarchy') {
        // "Cotovelo" (como um organograma de verdade): sai do meio da base
        // do cargo superior, desce reto até a metade do caminho, vira na
        // horizontal, e desce reto até o topo do cargo subordinado.
        const y1 = ra.top + ra.height - wrapRect.top + wrap.scrollTop
        const y2 = rb.top - wrapRect.top + wrap.scrollTop
        const midY = (y1 + y2) / 2
        return { id: p.id, kind: p.kind, path: `M ${aCenterX} ${y1} L ${aCenterX} ${midY} L ${bCenterX} ${midY} L ${bCenterX} ${y2}` }
      }

      // Ligação solta — reta simples, direto de centro a centro (é uma
      // conexão livre, não precisa parecer hierarquia).
      return { id: p.id, kind: p.kind, x1: aCenterX, y1: aCenterY, x2: bCenterX, y2: bCenterY }
    }).filter(Boolean)
    setSvgLines(lines)
  }, [nodes, links])

  useLayoutEffect(() => { recomputeLines() }, [recomputeLines])
  useEffect(() => {
    window.addEventListener('resize', recomputeLines)
    return () => window.removeEventListener('resize', recomputeLines)
  }, [recomputeLines])

  // Arrastar uma caixa: nada de bibliotecas — só acompanha o mouse, aplica
  // um transform local em tempo real (e recalcula as linhas a cada frame),
  // e no soltar persiste o deslocamento final.
  const onNodeMouseDown = (e, node) => {
    if (e.button !== 0) return
    e.preventDefault()
    const ds = {
      nodeId: node.id,
      startX: e.clientX, startY: e.clientY,
      startOffsetX: node.offset_x || 0, startOffsetY: node.offset_y || 0,
      currentOffsetX: node.offset_x || 0, currentOffsetY: node.offset_y || 0,
      moved: false,
    }
    dragStateRef.current = ds
    setDraggingId(node.id)

    const onMove = ev => {
      const dx = ev.clientX - ds.startX
      const dy = ev.clientY - ds.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true
      ds.currentOffsetX = ds.startOffsetX + dx
      ds.currentOffsetY = ds.startOffsetY + dy
      setNodes(prev => prev.map(n => n.id === ds.nodeId ? { ...n, offset_x: ds.currentOffsetX, offset_y: ds.currentOffsetY } : n))
    }
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragStateRef.current = null
      setDraggingId(null)
      if (!ds.moved) return
      try {
        await api.put(`/org-chart/${ds.nodeId}/position`, { offset_x: ds.currentOffsetX, offset_y: ds.currentOffsetY })
      } catch {
        load() // rollback via refetch, se falhar
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Converte um ponto do mouse (coordenadas da tela) pro espaço de
  // coordenadas do conteúdo do canvas (mesma base usada pelas posições
  // arrastadas dos cargos e pelas linhas de hierarquia/ligação).
  const toCanvasPoint = (clientX, clientY) => {
    const wrap = wrapRef.current
    const r = wrap.getBoundingClientRect()
    return { x: clientX - r.left + wrap.scrollLeft, y: clientY - r.top + wrap.scrollTop }
  }

  // Modo "✏️ Desenhar linha" (estilo Canva): clica e arrasta em qualquer
  // ponto do canvas (inclusive saindo de dentro de uma caixa) pra criar uma
  // linha solta, sem vínculo com nenhum cargo específico.
  const onCanvasMouseDown = e => {
    if (!drawMode || e.button !== 0) return
    e.preventDefault()
    const start = toCanvasPoint(e.clientX, e.clientY)
    const ds = { start, current: start }
    drawStateRef.current = ds
    setDrawPreview({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })

    const onMove = ev => {
      const cur = toCanvasPoint(ev.clientX, ev.clientY)
      ds.current = cur
      setDrawPreview({ x1: ds.start.x, y1: ds.start.y, x2: cur.x, y2: cur.y })
    }
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrawPreview(null)
      drawStateRef.current = null
      const dist = Math.hypot(ds.current.x - ds.start.x, ds.current.y - ds.start.y)
      if (dist < 6) return // clique sem arrastar — ignora, não cria linha de tamanho zero
      try {
        const { data } = await api.post('/org-chart/free-lines', {
          x1: ds.start.x, y1: ds.start.y, x2: ds.current.x, y2: ds.current.y,
        })
        setFreeLines(prev => [...prev, data])
      } catch (e) {
        setLinkError(e.response?.data?.error || 'Erro ao desenhar a linha.')
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const removeFreeLine = async line => {
    setFreeLines(prev => prev.filter(l => l.id !== line.id))
    try {
      await api.delete(`/org-chart/free-lines/${line.id}`)
    } catch {
      load() // rollback via refetch, se falhar
    }
  }

  const resetPosition = async node => {
    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, offset_x: 0, offset_y: 0 } : n))
    try {
      await api.put(`/org-chart/${node.id}/position`, { offset_x: 0, offset_y: 0 })
    } catch {
      load()
    }
  }

  const childrenByParent = useMemo(() => {
    const map = {}
    for (const n of nodes || []) {
      const key = n.parent_id || '__root__'
      if (!map[key]) map[key] = []
      map[key].push(n)
    }
    return map
  }, [nodes])

  const roots = childrenByParent['__root__'] || []

  // Layout "por nível" (estilo organograma de apresentação, não árvore
  // ramificada): todo mundo do mesmo escalão numa fileira horizontal só,
  // lado a lado — em vez de cada cargo ficar visualmente "dentro" do ramo
  // do pai específico dele. As linhas de hierarquia (SVG) continuam ligando
  // o pai de verdade a cada filho, então a relação real não se perde.
  const rows = useMemo(() => {
    const depthOf = {}
    const queue = (nodes || []).filter(n => !n.parent_id).map(n => n.id)
    for (const id of queue) depthOf[id] = 0
    let i = 0
    while (i < queue.length) {
      const id = queue[i++]
      for (const n of nodes || []) {
        if (n.parent_id === id && !(n.id in depthOf)) {
          depthOf[n.id] = depthOf[id] + 1
          queue.push(n.id)
        }
      }
    }
    const byDepth = {}
    for (const n of nodes || []) {
      // Órfão (parent_id apontando pra algo que sumiu) cai no topo, pra não desaparecer da tela.
      const d = depthOf[n.id] ?? 0
      if (!byDepth[d]) byDepth[d] = []
      byDepth[d].push(n)
    }
    for (const d in byDepth) {
      // Mantém irmãos (mesmo pai) agrupados lado a lado dentro da fileira.
      byDepth[d].sort((a, b) => {
        const pa = a.parent_id || '', pb = b.parent_id || ''
        if (pa !== pb) return pa.localeCompare(pb)
        return (a.order_index ?? 0) - (b.order_index ?? 0) || a.name.localeCompare(b.name, 'pt-BR')
      })
    }
    const maxDepth = Object.keys(byDepth).length ? Math.max(...Object.keys(byDepth).map(Number)) : -1
    return Array.from({ length: maxDepth + 1 }, (_, d) => byDepth[d] || [])
  }, [nodes])

  const onSaved = node => {
    setNodes(prev => {
      const exists = (prev || []).some(n => n.id === node.id)
      return exists ? prev.map(n => n.id === node.id ? node : n) : [...(prev || []), node]
    })
    setEditing(null)
  }

  const deleteNode = async node => {
    const childCount = (childrenByParent[node.id] || []).length
    const ok = await confirmDialog(
      childCount > 0
        ? `Excluir "${node.name}" e todos os ${childCount} cargo(s) abaixo dele na hierarquia?`
        : `Excluir "${node.name}"?`,
      { title: 'Excluir cargo' }
    )
    if (!ok) return
    try {
      await api.delete(`/org-chart/${node.id}`)
      load()
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  // Clique em "🔗 Ligar": primeiro clique escolhe a origem, segundo clique
  // (em outro cargo) cria a ligação; clicar de novo no mesmo cargo cancela.
  const handleLinkClick = async nodeId => {
    setLinkError('')
    if (!linkingFrom) { setLinkingFrom(nodeId); return }
    if (linkingFrom === nodeId) { setLinkingFrom(null); return }
    try {
      const { data } = await api.post('/org-chart/links', { from_node_id: linkingFrom, to_node_id: nodeId })
      setLinks(prev => [...prev, data])
    } catch (e) {
      setLinkError(e.response?.data?.error || 'Erro ao ligar os cargos.')
    } finally {
      setLinkingFrom(null)
    }
  }

  const removeLink = async link => {
    setLinks(prev => prev.filter(l => l.id !== link.id))
    try {
      await api.delete(`/org-chart/links/${link.id}`)
    } catch {
      load() // rollback via refetch, se falhar
    }
  }

  const nodeById = useMemo(() => Object.fromEntries((nodes || []).map(n => [n.id, n])), [nodes])
  const draggingNode = draggingId ? nodeById[draggingId] : null

  if (loading) return <div className={s.loading}>Carregando organograma...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Organograma</h1>
          <p className={s.sub}>Estrutura hierárquica da equipe — arraste uma caixa pra reorganizar o desenho.</p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${drawMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setDrawMode(v => !v); setLinkingFrom(null) }}
            >
              ✏️ {drawMode ? 'Desenhando (clique pra sair)' : 'Desenhar linha'}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo cargo</button>
          </div>
        )}
      </div>

      {canEdit && drawMode && (
        <div className={s.linkBanner}>
          Clique e arraste em qualquer ponto do canvas pra desenhar uma linha solta (estilo Canva), sem vínculo com nenhum cargo.
        </div>
      )}
      {canEdit && linkingFrom && (
        <div className={s.linkBanner}>
          Clique em outro cargo pra ligar a <strong>{nodeById[linkingFrom]?.name}</strong> (sem virar hierarquia).
          <button className="btn btn-ghost btn-sm" onClick={() => setLinkingFrom(null)}>Cancelar</button>
        </div>
      )}
      {canEdit && draggingNode && !!(draggingNode.offset_x || draggingNode.offset_y) && (
        <div className={s.linkBanner}>
          Movendo <strong>{draggingNode.name}</strong>...
          <button className="btn btn-ghost btn-sm" onClick={() => resetPosition(draggingNode)}>↺ Repor no lugar original</button>
        </div>
      )}
      {linkError && <p role="alert" className={s.fileError}>{linkError}</p>}

      {roots.length === 0 ? (
        <div className={s.empty}>
          <h3>Organograma vazio</h3>
          <p>{canEdit ? 'Comece adicionando o cargo do topo da hierarquia.' : 'Peça pra um Super Admin montar o organograma.'}</p>
        </div>
      ) : (
        <>
          <div
            className={s.treeWrap}
            ref={wrapRef}
            style={{ cursor: drawMode ? 'crosshair' : undefined }}
            onMouseDown={onCanvasMouseDown}
          >
            <div className={s.tree}>
              {rows.map((row, i) => (
                <div key={i} className={s.row}>
                  {row.map(node => (
                    <NodeBox
                      key={node.id}
                      node={node} canEdit={canEdit}
                      onAddChild={parentId => setEditing({ parent_id: parentId })}
                      onEdit={setEditing}
                      onDelete={deleteNode}
                      onLinkClick={handleLinkClick}
                      linkingFrom={linkingFrom}
                      registerNodeEl={registerNodeEl}
                      onNodeMouseDown={onNodeMouseDown}
                      draggingId={draggingId}
                      drawMode={drawMode}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Todas as linhas: hierarquia sólida + ligações soltas
                tracejadas (computadas da posição real das caixas, ver
                recomputeLines) + linhas livres estilo Canva (coordenadas
                fixas) + a prévia da linha sendo desenhada agora. */}
            <svg className={s.linksSvg} width={svgSize.width} height={svgSize.height}>
              {svgLines.map(l => l.kind === 'hierarchy'
                ? <path key={l.id} d={l.path} className={s.hierarchyLine} fill="none" />
                : <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={s.linkLine} />
              )}
              {freeLines.map(l => (
                <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={s.freeLine} />
              ))}
              {drawPreview && (
                <line x1={drawPreview.x1} y1={drawPreview.y1} x2={drawPreview.x2} y2={drawPreview.y2} className={s.freeLinePreview} />
              )}
            </svg>
          </div>

          {links.length > 0 && (
            <div className={s.linkList}>
              <span className={s.linkListTitle}>Conexões sem hierarquia:</span>
              {links.map(l => (
                <span key={l.id} className={s.linkChip}>
                  {nodeById[l.from_node_id]?.name || '?'} ↔ {nodeById[l.to_node_id]?.name || '?'}
                  {canEdit && <button onClick={() => removeLink(l)} title="Remover ligação">✕</button>}
                </span>
              ))}
            </div>
          )}

          {freeLines.length > 0 && (
            <div className={s.linkList}>
              <span className={s.linkListTitle}>Linhas soltas:</span>
              {freeLines.map((l, i) => (
                <span key={l.id} className={s.linkChip}>
                  Linha {i + 1}
                  {canEdit && <button onClick={() => removeFreeLine(l)} title="Remover linha">✕</button>}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <Editor
          node={editing.id ? editing : null}
          defaultParentId={editing.parent_id}
          nodes={nodes || []}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
