// Resume uma captura do `wrangler tail --format json`: quantas chamadas, ritmo
// por dia, por rota, por situação (200/401...) e por computador (IP + navegador).
//   npx wrangler tail uniflow --format json > trafego.jsonl   (Ctrl+C ou `timeout 60`)
//   node .claude/skills/saude-cloudflare/scripts/resumo-trafego.mjs trafego.jsonl
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('uso: node resumo-trafego.mjs <arquivo.jsonl>'); process.exit(1) }
const text = readFileSync(file, 'utf8')

// O tail imprime um JSON por evento, às vezes em várias linhas: lê objeto por objeto.
const events = []
let depth = 0, start = -1, inStr = false, esc = false
for (let i = 0; i < text.length; i++) {
  const ch = text[i]
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
  if (ch === '"') inStr = true
  else if (ch === '{') { if (depth++ === 0) start = i }
  else if (ch === '}' && --depth === 0) { try { const o = JSON.parse(text.slice(start, i + 1)); if (o.eventTimestamp) events.push(o) } catch { /* pedaço quebrado */ } }
}

const ts = events.map(e => e.eventTimestamp)
const minutes = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 60000 : 0
const perDay = minutes > 0 ? Math.round(events.length / minutes * 1440) : 0
console.log(`${events.length} eventos em ${minutes.toFixed(1)} min  →  ~${perDay.toLocaleString('pt-BR')} por dia (limite grátis: 100.000)`)

const count = (map, k) => map.set(k, (map.get(k) || 0) + 1)
const routes = new Map(), statuses = new Map(), who = new Map()
for (const e of events) {
  const ev = e.event || {}
  if (ev.cron) { count(routes, `CRON ${ev.cron}`); continue }
  const r = ev.request || {}
  const path = String(r.url || '?').replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/[0-9a-f-]{8,}|\/\d+/g, '/:id')
  count(routes, `${r.method} ${path}`)
  count(statuses, String(ev.response?.status ?? e.outcome))
  const h = r.headers || {}
  count(who, `${h['cf-connecting-ip'] || '?'} | ${(h['user-agent'] || '?').slice(0, 60)}`)
}
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log('situação:', Object.fromEntries(statuses))
console.log('\n— por rota'); for (const [k, v] of top(routes, 15)) console.log(String(v).padStart(6), k)
console.log('\n— por computador'); for (const [k, v] of top(who, 8)) console.log(String(v).padStart(6), k)

// Sinais de laço: uma rota sozinha com muitas chamadas recusadas, ou um computador dominando.
const loop = top(routes, 1)[0]
if (events.length > 30 && loop && loop[1] / events.length > 0.5) console.log(`\n⚠ possível laço: "${loop[0]}" é ${Math.round(loop[1] / events.length * 100)}% do tráfego`)
