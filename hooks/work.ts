// Pure helpers for what the agent does: plan steps and the requirements they serve,
// preview links in command output, and readable failure text.

import type { PlanStep, Requirement } from '../types'

const IDS = /\bR(\d+)\b/g
const WORD = /[a-z0-9]{3,}/g
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'add', 'make', 'use', 'show', 'all'])

const words = (s: string) => new Set((s.toLowerCase().match(WORD) ?? []).filter(w => !STOP.has(w)))

// Requirement ids a plan step serves: the ids it names ("[R2] Add tests"), else the
// requirement whose title it overlaps most (at least half of the title's words).
export function linkStep(text: string, reqs: Requirement[]): string[] {
  const named = [...text.matchAll(IDS)].map(m => `R${m[1]}`).filter(id => reqs.some(r => r.id === id))
  if (named.length) return [...new Set(named)]
  const w = words(text)
  let best: { id: string; score: number } | undefined
  for (const r of reqs) {
    const t = words(r.title)
    if (!t.size) continue
    const score = [...t].filter(x => w.has(x)).length / t.size
    if (score >= 0.5 && (!best || score > best.score)) best = { id: r.id, score }
  }
  return best ? [best.id] : []
}

type RawItem = { content?: unknown; text?: unknown; title?: unknown; status?: unknown }

// TodoWrite's `todos` and the desktop app's update_plan `items`.
export function planFrom(input: Record<string, unknown>, reqs: Requirement[]): PlanStep[] | undefined {
  const raw = (Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : undefined) as RawItem[] | undefined
  if (!raw) return undefined
  return raw
    .map(item => {
      const text = String(item.content ?? item.text ?? item.title ?? '').trim()
      const st = String(item.status ?? 'pending')
      const status: PlanStep['status'] = st === 'completed' || st === 'done' ? 'completed' : st === 'in_progress' || st === 'active' ? 'in_progress' : 'pending'
      return { text, status, reqIds: linkStep(text, reqs) }
    })
    .filter(s => s.text)
}

export const PLAN_TOOLS = new Set(['TodoWrite', 'mcp__ccd_turn__update_plan'])

// Local dev servers and common preview hosts printed by a command.
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+\.(?:localhost|test|vercel\.app|netlify\.app|pages\.dev|fly\.dev|onrender\.com|ngrok-free\.app|ngrok\.io))(?::\d+)?(?:\/[^\s'"`)<>\]]*)?/gi

export function previewUrls(output: string): string[] {
  return [...new Set((output.match(URL_RE) ?? []).map(u => u.replace(/[.,;:]+$/, '').replace('0.0.0.0', 'localhost')))].slice(0, 5)
}

export function failureText(tool: string, text: string): string {
  const first = text.replace(/\s+/g, ' ').trim()
  return `${tool}: ${first.length > 220 ? `${first.slice(0, 219)}…` : first || 'failed'}`
}

// ---------- shared by the pane and the window ----------

export type ReqFilterName = 'all' | 'open' | 'unverified' | 'verified' | 'conflicts' | 'yours' | 'agents'

export const REQ_FILTERS: { value: ReqFilterName; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'unverified', label: 'Done, not verified' },
  { value: 'verified', label: 'Verified' },
  { value: 'conflicts', label: 'Conflicts' },
  { value: 'yours', label: 'Asked by you' },
  { value: 'agents', label: 'Added by the agent' },
]

export const isVerified = (r: Requirement) => r.status === 'verified' && !r.needsReverify

export function filterReqs(reqs: Requirement[], query: string, filter: ReqFilterName): Requirement[] {
  const q = query.trim().toLowerCase()
  return reqs.filter(r => {
    if (q && !`${r.id} ${r.title} ${r.history.map(h => h.text).join(' ')}`.toLowerCase().includes(q)) return false
    switch (filter) {
      case 'open': return !isVerified(r) && r.status !== 'deferred'
      case 'unverified': return r.status === 'implemented' || Boolean(r.needsReverify)
      case 'verified': return isVerified(r)
      case 'conflicts': return Boolean(r.conflict)
      case 'yours': return r.history[0]?.by !== 'agent'
      case 'agents': return r.history[0]?.by === 'agent'
      default: return true
    }
  })
}

// What still stands between a requirement and verified; '' when nothing does.
export function gapOf(r: Requirement, plan: PlanStep[] = []): string {
  if (r.conflict) return `Conflicting instruction: ${r.conflict.reason}`
  if (r.needsReverify) return 'Changed after it was done; check it again'
  if (r.status === 'verified' || r.status === 'deferred') return ''
  if (plan.length && !plan.some(s => s.reqIds.includes(r.id)) && r.status === 'captured') return "Not in the agent's plan"
  switch (r.status) {
    case 'implemented': return 'Agent says done; no passing check yet'
    case 'captured': return "Not in the agent's work yet"
    case 'in_progress': return 'Still in progress'
    case 'blocked': return 'Blocked'
    case 'needs_clarification': return 'Waiting on you'
  }
  return ''
}

// Files that may hold secrets: never copied for diffs (their diff opens the file instead).
const SECRET = /(^|[\\/])(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|ed25519|ecdsa)[^\\/]*|[^\\/]*\.(pem|key|p12|pfx)|credentials[^\\/]*|secrets?\.[a-z]+)$/i
export const isSecretPath = (file: string) => SECRET.test(file)
