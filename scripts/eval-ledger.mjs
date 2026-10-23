// Measures how accurate a rebuilt ledger is on a real session: builds it the way Praetorium
// does (whole conversation, in order), then has a stronger model judge every requirement
// against the full conversation and list anything missed.
//
//   bun scripts/eval-ledger.mjs <session id> [--model claude-haiku-5-5] [--judge claude-fable-5-1] [--live]
//
// --live replays the conversation turn by turn through the prompts the plugin uses while a session
// runs (tag each message as it is sent; review each turn's reply and work), instead of rebuilding.

import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { REVIEW_SYSTEM, TAG_SYSTEM, buildLedger, judgeStatuses, parseReview, parseTagged, reviewPrompt, tagPrompt, turnsAsConversation } from '../hooks/tagging.ts'

const [id] = process.argv.slice(2)
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const MODEL = opt('model', 'claude-haiku-5-5')
const JUDGE = opt('judge', 'claude-fable-5-1')
if (!id) { console.error('usage: eval-ledger.mjs <session id> [--model m] [--judge m]'); process.exit(2) }

function claude(model, system, prompt, timeout = 600_000) {
  const r = spawnSync('claude', ['-p', '--model', model, '--system-prompt', system, '--tools', '', '--no-session-persistence', '--setting-sources', 'project'],
    { input: prompt, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' } })
  return r.status === 0 ? r.stdout : undefined
}

const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const imp = spawnSync(process.execPath, [new URL('../viewer/cli.mjs', import.meta.url).pathname, 'import', projects, '-', '--session', id], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const [past] = JSON.parse(imp.stdout || '[]')
if (!past) { console.error('no transcript for', id); process.exit(1) }
const finalReply = past.replies.at(-1)?.text ?? ''

const LIVE = process.argv.includes('--live')

// The live path: what the plugin does message by message and turn by turn.
async function replay() {
  const items = []
  const turns = []
  let n = 0
  for (const [i, p] of past.prompts.entries()) {
    const known = items.map(r => ({ id: r.id, title: r.title }))
    const tagged = parseTagged(claude(MODEL, TAG_SYSTEM, tagPrompt(known, p.text, p.lastReply)) ?? '')
    for (const t of tagged) {
      const target = t.refines ? items.find(r => r.id === t.refines) : undefined
      if (target && t.revisit) { target.status = 'implemented'; target.refinements.push({ at: p.at, text: t.quote || t.title }); continue }
      if (target) {
        target.refinements.push({ at: p.at, text: t.quote || t.title })
        if (target.status === 'implemented') target.status = 'in_progress'
        continue
      }
      items.push({ id: `R${++n}`, title: t.title, status: 'captured', at: p.at, quote: t.quote || t.title, refinements: [] })
    }
    // The turn this message started: its last reply is what turn.complete hands the review.
    const end = past.prompts[i + 1]?.at ?? Number.POSITIVE_INFINITY
    const turn = past.replies.filter(r => r.at >= p.at && r.at < end)
    const work = past.tools.filter(t => t.at >= p.at && t.at < end && /^(Edit|Write|MultiEdit|NotebookEdit|Bash)$/.test(t.tool))
      .map(t => `${t.tool === 'Bash' ? 'Command' : 'Code change'}: ${t.description || t.command || t.file_path || ''}${t.isError ? ' (failed)' : ''}`.slice(0, 160))
    const answer = turn.at(-1)?.text ?? ''
    if (!answer && !work.length) continue
    const review = parseReview(claude(MODEL, REVIEW_SYSTEM, reviewPrompt(items, answer, work, p.text)) ?? '')
    for (const pr of review.progress) {
      const r = items.find(x => x.id === pr.id)
      if (r) { r.status = pr.status; r.why = pr.why }
    }
    // As the plugin does: record the turn, and every 6 turns re-judge open requirements against all turns so far.
    turns.push({ at: p.at, ask: p.text.slice(0, 1500), answer: answer.slice(0, 3000) })
    if (turns.length % 6 === 0) {
      const open = items.filter(r => r.status !== 'verified')
      const { prompts, replies } = turnsAsConversation(turns)
      await judgeStatuses(open, prompts, replies, async (system, prompt) => claude(MODEL, system, prompt))
    }
  }
  return { items }
}

const t0 = Date.now()
const built = LIVE ? await replay() : await buildLedger(past.prompts, past.replies, async (system, prompt) => claude(MODEL, system, prompt))
if (built.failed) { console.error('build failed:', built.failed); process.exit(1) }
const secs = Math.round((Date.now() - t0) / 1000)

const talk = past.prompts.map((p, i) => `${p.lastReply ? `[agent]: ${p.lastReply}\n` : ''}[user message ${i + 1}]: ${p.text}`).join('\n\n') + `\n\n[agent's last reply]: ${finalReply}`
const ledger = built.items.map(r => `${r.id} [${r.status}] ${r.title}${r.refinements.length ? ` (+${r.refinements.length} refinements)` : ''}`).join('\n')
const JUDGE_SYSTEM =
  'You audit a requirements ledger built from a conversation between a developer and a coding agent. Be strict and concrete. ' +
  'Reply with JSON only: {"items":[{"id":string,"real":boolean,"status_ok":boolean,"should_be":string,"note":string}],"missed":[{"message":number,"ask":string}]}. ' +
  'For EVERY ledger item: real = it is something the developer actually asked for (not invented, not a question asked only to understand). ' +
  'status_ok = its status matches what the conversation shows by its end. Statuses: captured (never started), in_progress (worked on, unfinished), ' +
  'implemented (the agent did it or said it was done), blocked, needs_clarification. Verified is not available, so a finished item should be implemented. ' +
  'should_be: the right status when status_ok is false. missed: asks the developer made that no ledger item covers (merge duplicates; skip trivial approvals).'
const verdict = claude(JUDGE, JUDGE_SYSTEM, `Ledger:\n${ledger}\n\nConversation:\n${talk}`)
let v
try { v = JSON.parse(verdict.slice(verdict.indexOf('{'), verdict.lastIndexOf('}') + 1)) } catch { console.error('judge gave no JSON'); process.exit(1) }
const items = v.items ?? []
const real = items.filter(i => i.real).length
const statusOk = items.filter(i => i.real && i.status_ok).length
console.log(`${past.title || id} · ${past.prompts.length} messages · ${LIVE ? 'replayed live' : 'rebuilt'} by ${MODEL} in ${secs}s · judged by ${JUDGE}`)
console.log(`requirements: ${built.items.length} · real: ${real}/${items.length} · status right: ${statusOk}/${real} · missed asks: ${(v.missed ?? []).length}`)
for (const i of items.filter(x => !x.real || !x.status_ok)) {
  const r = built.items.find(x => x.id === i.id)
  console.log(`  ${i.real ? 'STATUS' : 'NOT REAL'} ${i.id} [${r?.status}${i.real ? ` → ${i.should_be}` : ''}] ${r?.title ?? ''} — ${i.note}`)
}
for (const m of v.missed ?? []) console.log(`  MISSED (message ${m.message}) ${m.ask}`)
