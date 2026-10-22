import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  ActivityEvent,
  Delivery,
  EventKind,
  Filter,
  Reply,
  ReplyMode,
  ReqStatus,
  Requirement,
  View,
} from '../types'

type $T = EngineInterface

const PANE = 'ledger'
const TOOL = 'mcp__ledger__ledger'
const HAIKU = 'claude-haiku-5-5'
const SNAP_DIR = '/tmp/claude-ledger'
const HUMAN = new Set(['composer', 'bridge', 'sdk'])
const TEST_RE = /\b(test|tests|jest|vitest|pytest|mix test|rspec|playwright|cypress|tsc|typecheck|lint|eslint|build|cargo check|go vet)\b/i

const DEFAULT_VIEW: View = {
  tab: 'reqs',
  mode: 'comment',
  refines: 'new',
  interrupt: false,
  filter: 'key',
  dark: true,
}

const reqsA = atom({ plugin: 'ledger', key: 'reqs' } as const, [] as Requirement[])
const eventsA = atom({ plugin: 'ledger', key: 'events' } as const, [] as ActivityEvent[])
const repliesA = atom({ plugin: 'ledger', key: 'replies' } as const, [] as Reply[])
const viewA = atom({ plugin: 'ledger', key: 'view' } as const, DEFAULT_VIEW)
const turnA = atom({ plugin: 'ledger', key: 'turnId' } as const, '')
const inboxSeqA = atom({ plugin: 'ledger', key: 'inboxSeq' } as const, 0)
const titleA = atom({ plugin: 'ledger', key: 'title' } as const, '')

// Telborg tokens (telborg_news/design.md, --dc-*). Dim = hue at ~14% over surface.
const PALETTE = {
  dark: {
    bg: '#0a0a0a', surface: '#121212', surface2: '#1f1f1f', border: '#292929', border2: '#3a3a3a',
    text: '#e2e8f0', text2: '#9d9d9d', text3: '#5d5d5d',
    lime: '#c3f73a', lav: '#af74fb', rose: '#f45286', amber: '#f5a623',
    limeDim: '#2b3218', lavDim: '#282033', roseDim: '#321b22', amberDim: '#322714', mutedDim: '#1f1f1f',
  },
  light: {
    bg: '#fafaf7', surface: '#ffffff', surface2: '#f1f1ec', border: '#e2e2dc', border2: '#cfcfc7',
    text: '#111111', text2: '#3f3f3f', text3: '#6a6a6a',
    lime: '#4a6b08', lav: '#6b21d4', rose: '#c81e5b', amber: '#a16207',
    limeDim: '#e9ede1', lavDim: '#ede4fa', roseDim: '#f8e4eb', amberDim: '#f4ece1', mutedDim: '#f1f1ec',
  },
}
type Pal = typeof PALETTE.dark
type Tone = 'lime' | 'lav' | 'rose' | 'amber' | 'muted'
const fg = (p: Pal, t: Tone) => (t === 'muted' ? p.text3 : p[t])
const bgOf = (p: Pal, t: Tone) => p[`${t}Dim` as const]

const STATUS: Record<ReqStatus, { label: string; tone: Tone }> = {
  captured: { label: 'Not started', tone: 'muted' },
  in_progress: { label: 'In progress', tone: 'lav' },
  implemented: { label: 'Implemented · not verified', tone: 'amber' },
  verified: { label: 'Verified', tone: 'lime' },
  blocked: { label: 'Blocked', tone: 'rose' },
  needs_clarification: { label: 'Needs clarification', tone: 'amber' },
  deferred: { label: 'Deferred', tone: 'muted' },
}

const KIND: Record<EventKind, { label: string; tone: Tone }> = {
  discovery: { label: 'Discovery', tone: 'muted' },
  plan: { label: 'Plan', tone: 'lav' },
  code: { label: 'Code change', tone: 'lav' },
  command: { label: 'Command', tone: 'muted' },
  test: { label: 'Test', tone: 'amber' },
  message: { label: 'Agent message', tone: 'lav' },
}

const DELIVERY: Record<Delivery, string> = {
  kept: 'Comment · not sent to agent',
  queued: 'Queued · goes with your next prompt',
  received: 'Received by agent',
  acted: 'Agent finished a turn after receiving it',
  failed: 'Not delivered',
}

// Editors are found on the machine at session start; module state is fine
// because session.start runs again on every reload.
let editors: { name: string; bin: string }[] = []
let storeKey = ''
let sessionId = ''
let nodeBin = ''
let project = ''
let hasEnded = false
const stateFile = () => `${SNAP_DIR}/state-${sessionId}.json`
const inboxFile = () => `${SNAP_DIR}/inbox-${sessionId}.jsonl`

const now = () => Date.now()
const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const base = (p: string) => p.split('/').pop() ?? p
const nextId = (reqs: Requirement[]) => `R${reqs.length + 1}`
const uid = () => `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// The terminal window reads this file; it holds nothing the session state doesn't.
async function mirror($: $T) {
  if (!sessionId) return
  try {
    const [reqs, replies, events, turnId, title] = await Promise.all([read($, reqsA), read($, repliesA), read($, eventsA), read($, turnA), read($, titleA)])
    await $.fs.write(stateFile(), JSON.stringify({
      sessionId, project, title, hasEnded,
      reqs, replies, events: events.slice(-200), isWorking: Boolean(turnId) && !hasEnded, editors, snapDir: SNAP_DIR, at: now(),
    }))
  } catch {
    // the window just shows the last state it read
  }
}

async function save($: $T) {
  await mirror($)
  if (!storeKey) return
  try {
    const [reqs, replies, events] = await Promise.all([read($, reqsA), read($, repliesA), read($, eventsA)])
    await $.store.set(storeKey, { reqs, replies, events: events.slice(-150) })
    const keys = (await $.store.keys()).filter(k => k.startsWith('s:'))
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await $.store.delete(k)
  } catch {
    // persistence is best effort; the session state still holds everything
  }
}

async function pushEvent($: $T, ev: ActivityEvent) {
  await update($, eventsA, list => [...list, ev].slice(-300))
  await mirror($)
}

async function patchEvent($: $T, id: string, patch: Partial<ActivityEvent>) {
  await update($, eventsA, list => list.map(ev => (ev.id === id ? { ...ev, ...patch } : ev)))
  await mirror($)
}

// ---------- requirement tagging (Haiku) ----------

type Tagged = { title: string; quote: string; refines: string | null }

async function tag($: $T, text: string, reqs: Requirement[]): Promise<Tagged[]> {
  const existing = reqs.length
    ? reqs.map(r => `${r.id}: ${r.title}`).join('\n')
    : '(none)'
  const system =
    'You split a developer\'s message to a coding agent into atomic, checkable requirements. ' +
    'Reply with JSON only: {"items":[{"title":string,"quote":string,"refines":string|null}]}. ' +
    'title: imperative, at most 12 words. quote: the exact words from the message it comes from. ' +
    'refines: the id of an existing requirement this changes or corrects, else null. ' +
    'A request phrased as a question ("how do I make it…", "can we…", "could you…", "why isn\'t X…") IS a requirement: state the outcome the user wants. ' +
    'Skip only questions that ask for information and want nothing built or changed, approvals ("yes", "go ahead", "continue"), and chit-chat. ' +
    'When unsure, include it. ' +
    'Reply {"items":[]} when there is no requirement.'
  const prompt = `Existing requirements:\n${existing}\n\nMessage:\n${text}`
  const res = await $.model.complete({ model: HAIKU, system, prompt })
  if (!res.isAnswered) return []
  const raw = res.text
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  try {
    const items = (JSON.parse(json) as { items?: Tagged[] }).items ?? []
    return items.filter(i => typeof i.title === 'string' && i.title.trim())
  } catch {
    return []
  }
}

async function capture($: $T, text: string): Promise<string[]> {
  const reqs = await read($, reqsA)
  const tagged = await tag($, text, reqs)
  if (!tagged.length) return []
  const touched: string[] = []
  await update($, reqsA, list => {
    let out = [...list]
    for (const t of tagged) {
      const target = t.refines ? out.find(r => r.id === t.refines) : undefined
      const version = { at: now(), text: t.quote || t.title, kind: target ? 'refinement' : 'original', by: 'you' } as const
      if (target) {
        const wasDone = target.status === 'implemented' || target.status === 'verified'
        out = out.map(r =>
          r.id === target.id
            ? { ...r, history: [...r.history, version], needsReverify: wasDone || r.needsReverify, status: wasDone ? 'in_progress' : r.status }
            : r,
        )
        touched.push(`${target.id} (refined): ${t.title}`)
      } else {
        const id = nextId(out)
        out = [...out, { id, title: t.title, status: 'captured', at: now(), history: [version], evidence: [] }]
        touched.push(`${id}: ${t.title}`)
      }
    }
    return out
  })
  return touched
}

// ---------- activity events from tool calls ----------

function describe(e: Record<string, unknown>): ActivityEvent | undefined {
  const tool = String(e.tool)
  const id = String(e.tool_use_id)
  const at = now()
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      const file = s('file_path') || s('notebook_path')
      return { id, kind: 'code', at, title: `${tool === 'Write' ? 'Wrote' : 'Edited'} ${base(file)}`, file, state: 'running' }
    }
    case 'Bash': {
      const cmd = s('command')
      const kind: EventKind = TEST_RE.test(cmd) ? 'test' : 'command'
      return { id, kind, at, title: s('description') || clip(cmd, 80), detail: cmd, state: 'running' }
    }
    case 'Read':
      return { id, kind: 'discovery', at, title: `Read ${base(s('file_path'))}`, file: s('file_path') }
    case 'Grep':
    case 'Glob':
      return { id, kind: 'discovery', at, title: `Searched “${clip(s('pattern'), 50)}”` }
    case 'WebFetch':
    case 'WebSearch':
      return { id, kind: 'discovery', at, title: clip(s('url') || s('query'), 80) }
    case 'TodoWrite': {
      const todos = Array.isArray(e.todos) ? (e.todos as { content?: string; status?: string }[]) : []
      const detail = todos.map(t => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '›' : '·'} ${t.content ?? ''}`).join('\n')
      return { id, kind: 'plan', at, title: 'Plan updated', detail }
    }
    case 'ExitPlanMode':
      return { id, kind: 'plan', at, title: 'Plan proposed', detail: clip(s('plan'), 1500) }
    case 'Agent':
    case 'Task':
      return { id, kind: 'plan', at, title: `Subagent: ${clip(s('description'), 60)}`, state: 'running' }
    default:
      return undefined
  }
}

async function snapshot($: $T, ev: ActivityEvent) {
  if (!ev.file) return
  try {
    const exists = await $.fs.exists(ev.file)
    const text = exists ? String(await $.fs.read(ev.file)) : ''
    await $.fs.write(`${SNAP_DIR}/${ev.id}-${base(ev.file)}`, text)
  } catch {
    // no snapshot: the diff button falls back to opening the file
  }
}

async function openDiff($: $T, ev: ActivityEvent, how: string) {
  if (!ev.file) return
  const snap = `${SNAP_DIR}/${ev.id}-${base(ev.file)}`
  const hasSnap = await $.fs.exists(snap).catch(() => false)
  if (how === 'terminal') {
    const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`
    const cmd = hasSnap
      ? `git --no-pager diff --no-index --color -- ${q(snap)} ${q(ev.file)}`
      : `git --no-pager -C ${q(ev.file.replace(/\/[^/]*$/, ''))} diff --color -- ${q(ev.file)}`
    const script = `tell application "Terminal" to do script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    await $.process.run(['osascript', '-e', script, '-e', 'tell application "Terminal" to activate'])
    return
  }
  const ed = editors.find(x => x.name === how)
  if (!ed) return
  await $.process.run(hasSnap ? [ed.bin, '--diff', snap, ev.file] : [ed.bin, '-g', ev.file])
}

// ---------- delivering replies to the agent ----------

async function deliver($: $T, text: string, opts: { interrupt: boolean; start: boolean }): Promise<Delivery> {
  const turnId = await read($, turnA)
  try {
    if (turnId && opts.interrupt) {
      await $.turn.abort({ turnId })
      await $.prompt.submit({ text })
      return 'received'
    }
    if (turnId) {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      return 'received'
    }
    if (opts.start) {
      await $.prompt.submit({ text })
      return 'received'
    }
    return 'queued'
  } catch {
    return 'failed'
  }
}

type ReplyOpts = { mode: ReplyMode; refines: string; interrupt: boolean }

async function sendReply($: $T, ev: ActivityEvent | undefined, text: string, view: ReplyOpts) {
  const reply: Reply = { id: uid(), eventId: ev?.id ?? '', at: now(), text, mode: view.mode, delivery: 'kept', interrupt: view.interrupt || undefined }
  const about = ev
    ? `[Ledger] The user replied to activity "${ev.title}" (${hhmm(ev.at)}${ev.file ? `, ${ev.file}` : ''})`
    : '[Ledger] The user wrote'

  if (view.mode === 'requirement') {
    let reqId = view.refines
    await update($, reqsA, (list): Requirement[] => {
      const version = { at: now(), text, kind: 'refinement', by: 'you' } as const
      const target = list.find(r => r.id === reqId)
      if (target) {
        const wasDone = target.status === 'implemented' || target.status === 'verified'
        return list.map(r =>
          r.id === reqId ? { ...r, history: [...r.history, version], needsReverify: true, status: wasDone ? 'in_progress' : r.status } : r,
        )
      }
      reqId = nextId(list)
      return [...list, { id: reqId, title: clip(text, 90), status: 'captured', at: now(), history: [{ ...version, kind: 'original' }], evidence: [] }]
    })
    reply.reqId = reqId
    reply.delivery = await deliver(
      $,
      `${about}, as a requirement (${reqId}): "${text}". Treat ${reqId} as in scope and re-verify it.`,
      { interrupt: view.interrupt, start: false },
    )
  } else if (view.mode === 'redirect') {
    reply.delivery = await deliver($, `${about}, as an instruction: ${text}`, { interrupt: view.interrupt, start: true })
  }

  await update($, repliesA, list => [...list, reply])
  await update($, viewA, v => ({ ...v, interrupt: false }))
  await save($)
}

async function acceptReq($: $T, id: string) {
  await update($, reqsA, (list): Requirement[] => list.map(x => x.id === id
    ? { ...x, status: 'verified', needsReverify: false, evidence: [...x.evidence, { kind: 'manual', at: now(), text: 'Checked and accepted' }] }
    : x))
  await save($)
}

async function deferReq($: $T, id: string) {
  await update($, reqsA, (list): Requirement[] => list.map(x => (x.id === id ? { ...x, status: 'deferred' } : x)))
  await save($)
}

function gapOf(r: Requirement): string {
  if (r.needsReverify) return 'Changed after it was done; check it again'
  switch (r.status) {
    case 'verified': return ''
    case 'implemented': return 'Agent says done; no passing check yet'
    case 'captured': return 'Not in the agent\'s work yet'
    case 'in_progress': return 'Still in progress'
    case 'blocked': return 'Blocked'
    case 'needs_clarification': return 'Waiting on you'
    case 'deferred': return ''
  }
}

async function askGaps($: $T): Promise<number> {
  const open = (await read($, reqsA)).filter(r => gapOf(r))
  if (open.length) {
    await deliver(
      $,
      `[Ledger] Before calling this done, close these gaps and report each with the ${TOOL} tool:\n${open.map(r => `${r.id} ${r.title}: ${gapOf(r)}`).join('\n')}`,
      { interrupt: false, start: true },
    )
  }
  return open.length
}

// ---------- the terminal window ----------

type InboxCommand =
  | { seq: number; type: 'reply'; eventId?: string; text: string; mode: ReplyMode; refines?: string; interrupt?: boolean }
  | { seq: number; type: 'accept' | 'defer'; reqId: string }
  | { seq: number; type: 'gaps' }

async function pollInbox($: $T) {
  if (!sessionId || !(await $.fs.exists(inboxFile()).catch(() => false))) return
  const last = await read($, inboxSeqA)
  const lines = String(await $.fs.read(inboxFile())).split('\n').filter(Boolean)
  const cmds: InboxCommand[] = []
  for (const line of lines) {
    try {
      const c = JSON.parse(line) as InboxCommand
      if (typeof c.seq === 'number' && c.seq > last) cmds.push(c)
    } catch {
      // a half-written line is read again next poll
    }
  }
  if (!cmds.length) return
  await update($, inboxSeqA, () => Math.max(...cmds.map(c => c.seq)))
  const events = await read($, eventsA)
  for (const c of cmds) {
    if (c.type === 'reply' && c.text.trim()) {
      const ev = events.find(x => x.id === c.eventId)
      await sendReply($, ev, c.text.trim(), { mode: c.mode, refines: c.refines ?? 'new', interrupt: Boolean(c.interrupt) })
    } else if (c.type === 'accept') {
      await acceptReq($, c.reqId)
    } else if (c.type === 'defer') {
      await deferReq($, c.reqId)
    } else if (c.type === 'gaps') {
      await askGaps($)
    }
  }
}

async function openWindow($: $T): Promise<string> {
  if (!nodeBin) return 'Node was not found on this machine, so the window cannot run.'
  await mirror($)
  const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`
  const cmd = `clear; exec ${q(nodeBin)} ${q(`${$.plugin.root}/viewer/ledger-view.mjs`)} ${q(SNAP_DIR)} ${q(sessionId)}`
  const as = (x: string) => x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const hasITerm = await $.fs.exists('/Applications/iTerm.app').catch(() => false)
  const script = hasITerm
    ? ['tell application "iTerm"', 'activate', 'set w to (create window with default profile)', `tell current session of w to write text "${as(cmd)}"`, 'end tell']
    : ['tell application "Terminal"', 'activate', `do script "${as(cmd)}"`, 'end tell']
  const ran = await $.process.run(['osascript', ...script.flatMap(l => ['-e', l])])
  return ran.exitCode === 0 ? `Ledger window opened in ${hasITerm ? 'iTerm' : 'Terminal'}.` : `Could not open the window: ${ran.stderr.trim()}`
}

// ---------- the agent's ledger tool ----------

const TOOL_DESCRIPTION =
  'The user\'s requirements ledger (ids R1, R2…). Call it when you start or finish work on a requirement, ' +
  'when one is blocked or unclear, or to split one into smaller ones. ' +
  'status "verified" is accepted only with test_command: a substring of a test/build command you ran that passed after your last edit; otherwise it is recorded as implemented.'

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['update', 'add'] },
    id: { type: 'string', description: 'Requirement id, for update' },
    status: { type: 'string', enum: ['in_progress', 'implemented', 'verified', 'blocked', 'needs_clarification'] },
    test_command: { type: 'string' },
    note: { type: 'string', description: 'Evidence or reason, one line' },
    title: { type: 'string', description: 'For add: the new requirement' },
    derived_from: { type: 'string', description: 'For add: the id it was split from' },
  },
  required: ['action'],
}

async function ledgerTool($: $T, a: Record<string, unknown>): Promise<string> {
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  if (s('action') === 'add') {
    if (!s('title')) return 'title is required for add'
    let id = ''
    await update($, reqsA, (list): Requirement[] => {
      id = nextId(list)
      const from = s('derived_from')
      return [...list, {
        id, title: s('title'), status: 'captured', at: now(), evidence: [],
        history: [{ at: now(), text: from ? `Split from ${from}: ${s('title')}` : s('title'), kind: 'original', by: 'agent' }],
      }]
    })
    await save($)
    return `Added ${id}.`
  }
  const reqs = await read($, reqsA)
  const req = reqs.find(r => r.id === s('id'))
  if (!req) return `No requirement ${s('id')}. Known: ${reqs.map(r => r.id).join(', ') || 'none'}.`
  let status = (s('status') || req.status) as ReqStatus
  let reply = `${req.id} → ${STATUS[status].label}.`
  const evidence = [...req.evidence]
  if (status === 'verified') {
    const events = await read($, eventsA)
    const lastEdit = Math.max(0, ...events.filter(x => x.kind === 'code').map(x => x.at))
    const cmd = s('test_command')
    const pass = cmd
      ? [...events].reverse().find(x => (x.kind === 'test' || x.kind === 'command') && x.state === 'ok' && x.at >= lastEdit && (x.detail ?? '').includes(cmd))
      : undefined
    if (pass) {
      evidence.push({ kind: 'test', at: now(), text: pass.detail ?? pass.title, eventId: pass.id })
    } else {
      status = 'implemented'
      reply = `${req.id} recorded as implemented, NOT verified: no passing command matching "${cmd}" ran after the last edit. Run the check, then update again.`
    }
  }
  if (s('note')) evidence.push({ kind: 'note', at: now(), text: s('note') })
  await update($, reqsA, list =>
    list.map(r => (r.id === req.id ? { ...r, status, evidence, needsReverify: status === 'verified' ? false : r.needsReverify } : r)),
  )
  await save($)
  return reply
}

// ---------- pane size ----------

// A pane can only ask for a width; the person's own drag on the dock wins.
const WIDE_COLUMNS = 400
const NARROW_COLUMNS = 72
const SIDE_BY_SIDE_AT = 130

async function openPane($: $T): Promise<string> {
  const width = (await $.store.get('width').catch(() => undefined)) === 'wide' ? 'wide' : 'narrow'
  await $.ui.open({ id: PANE, title: 'Ledger', columns: width === 'wide' ? WIDE_COLUMNS : NARROW_COLUMNS })
  return width
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      sessionId = await $.session.id()
      project = base(await $.session.root())
      hasEnded = false
      storeKey = `s:${sessionId}`
      const saved = (await $.store.get(storeKey)) as { reqs?: Requirement[]; replies?: Reply[]; events?: ActivityEvent[] } | undefined
      if (saved && (await read($, reqsA)).length === 0) {
        if (saved.reqs) await update($, reqsA, () => saved.reqs ?? [])
        if (saved.replies) await update($, repliesA, () => saved.replies ?? [])
        if (saved.events) await update($, eventsA, () => saved.events ?? [])
      }
      const dark = await $.store.get('dark')
      if (typeof dark === 'boolean') await update($, viewA, v => ({ ...v, dark }))
    } catch {
      // fresh session state
    }
    const found: { name: string; bin: string }[] = []
    for (const [name, bin] of [
      ['Cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
      ['VS Code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
    ] as const) {
      if (await $.fs.exists(bin).catch(() => false)) found.push({ name, bin })
    }
    editors = found
    await $.process.run(['mkdir', '-p', SNAP_DIR]).catch(() => undefined)
    const which = await $.process.run(['/bin/zsh', '-lc', 'command -v node']).catch(() => undefined)
    nodeBin = which?.exitCode === 0 ? which.stdout.trim().split('\n').pop() ?? '' : ''
    $.clock.every(700, () => void pollInbox($).catch(() => undefined))
    await mirror($)
    await $.tool.register({ name: 'ledger', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'ledger', description: 'Open the requirements ledger pane', argumentHint: '[window | wide | narrow]' })
    void openPane($)
    return next(e)
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'window') return { text: await openWindow($) }
    if (arg === 'wide' || arg === 'narrow') await $.store.set('width', arg)
    const width = await openPane($)
    return { text: `Ledger opened (${width}). /ledger window opens it in iTerm; /ledger wide or /ledger narrow resizes this pane; dragging the pane edge also works.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !HUMAN.has(e.origin.kind)) return next(e)
    const context = [...(e.context ?? [])]
    if (!(await read($, titleA))) await update($, titleA, () => clip(e.text.replace(/\s+/g, ' ').trim(), 70))
    const touched = await capture($, e.text)
    if (touched.length) {
      context.push(`[Ledger] Captured from this message:\n${touched.join('\n')}\nReport progress with the ${TOOL} tool.`)
    }
    const queued = (await read($, repliesA)).filter(r => r.delivery === 'queued')
    if (queued.length) {
      const reqs = await read($, reqsA)
      context.push(`[Ledger] Requirements the user added while you were idle:\n${queued.map(r => `${r.reqId}: ${reqs.find(x => x.id === r.reqId)?.title ?? r.text}`).join('\n')}`)
      await update($, repliesA, list => list.map(r => (r.delivery === 'queued' ? { ...r, delivery: 'received' as const } : r)))
    }
    await save($)
    return context.length ? next({ ...e, context }) : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => ({ result: await ledgerTool($, e as unknown as Record<string, unknown>) }))

  on('tool.call', async ($, e, next) => {
    if (e.agentId || String(e.tool) === TOOL) return next(e)
    const ev = describe(e as unknown as Record<string, unknown>)
    if (!ev) return next(e)
    if (ev.kind === 'code') await snapshot($, ev)
    await pushEvent($, ev)
    const ran = await next(e)
    if (ev.state === 'running') {
      await patchEvent($, ev.id, { state: ran.deny !== undefined || ran.isError === true ? 'failed' : 'ok' })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    hasEnded = true
    await mirror($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, turnA, () => e.turnId)
      await mirror($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const running = await read($, turnA)
    if (running && running === e.turnId) {
      await update($, turnA, () => '')
      if (e.answer.trim()) {
        await pushEvent($, { id: `m-${e.turnId}`, kind: 'message', at: now(), title: clip(e.answer.split('\n')[0] ?? '', 90), detail: clip(e.answer, 2000) })
      }
      await update($, repliesA, list => list.map(r => (r.delivery === 'received' ? { ...r, delivery: 'acted' as const } : r)))
      await save($)
    }
    return next(e)
  })

  // ---------- the pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === "mobile") {
      const { Text } = $.ui.resolve(e)
      return <Text>Open the ledger on desktop.</Text>
    }
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const [reqs, events, replies, view] = await Promise.all([read($, reqsA), read($, eventsA), read($, repliesA), read($, viewA)])
    const p = view.dark ? PALETTE.dark : PALETTE.light
    const setView = (patch: Partial<View>) => update($, viewA, v => ({ ...v, ...patch }))
    const chip = (label: string, tone: Tone) => (
      <Text color={fg(p, tone)} backgroundColor={bgOf(p, tone)}> {label} </Text>
    )
    const verified = reqs.filter(r => r.status === 'verified' && !r.needsReverify).length
    const live = reqs.filter(r => r.status !== 'deferred')

    const tabs = (
      <Box flexDirection="row" gap={1} paddingBottom={1}>
        {([['reqs', `Requirements ${reqs.length}`], ['activity', `Activity ${events.length}`], ['audit', 'Audit']] as const).map(([tab, label]) => (
          <Button key={`tab-${tab}`} label={label} plain dimColor={view.tab !== tab} onPress={() => setView({ tab })} />
        ))}
        <Button key="theme" label={view.dark ? 'Light mode' : 'Dark mode'} plain dimColor onPress={async () => { await setView({ dark: !view.dark }); await $.store.set('dark', !view.dark) }} />
      </Box>
    )

    const header = (
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={p.text} bold>Ledger</Text>
        <Text color={p.text2}>
          {live.length} requirements · <Text color={p.lime}>{verified} verified</Text> · {live.length - verified} open
        </Text>
      </Box>
    )

    // ----- requirements -----
    const reqRow = (r: Requirement) => (
      <Box key={`r-${r.id}`} flexDirection="column" paddingY={0}>
        <Box flexDirection="row" gap={1}>
          {chip(r.needsReverify ? 'Needs re-verification' : STATUS[r.status].label, r.needsReverify ? 'amber' : STATUS[r.status].tone)}
          <Button key={`rb-${r.id}`} label={`${r.id}  ${r.title}`} plain onPress={() => setView({ selectedReq: view.selectedReq === r.id ? undefined : r.id })} />
        </Box>
        {view.selectedReq === r.id && (
          <Box flexDirection="column" paddingLeft={2} paddingY={1} borderStyle="single" borderColor={p.border}>
            {r.history.map((h, i) => (
              <Text key={`h-${i}`} color={p.text2}>
                <Text color={p.text3}>{hhmm(h.at)} {h.kind === 'original' ? 'Asked' : 'Refined'}{h.by === 'agent' ? ' (agent)' : ''}: </Text>“{h.text}”
              </Text>
            ))}
            {r.evidence.length === 0 && <Text color={p.text3}>No evidence yet.</Text>}
            {r.evidence.map((ev, i) => (
              <Text key={`e-${i}`} color={ev.kind === 'test' || ev.kind === 'manual' ? p.lime : p.text2}>
                {ev.kind === 'test' ? 'Passed: ' : ev.kind === 'manual' ? 'Accepted by you: ' : 'Note: '}{ev.text}
              </Text>
            ))}
            {replies.filter(x => x.reqId === r.id).map(x => (
              <Text key={`rr-${x.id}`} color={p.text2}>Your reply {hhmm(x.at)} · {DELIVERY[x.delivery]}</Text>
            ))}
            <Box flexDirection="row" gap={1} paddingTop={1}>
              <Button key={`acc-${r.id}`} label="Accept as verified" onPress={() => acceptReq($, r.id)} />
              <Button key={`def-${r.id}`} label="Defer" onPress={() => deferReq($, r.id)} />
            </Box>
          </Box>
        )}
      </Box>
    )

    const reqsTab = (
      <Box flexDirection="column">
        {reqs.length === 0 && <Text color={p.text3}>Requirements are tagged from your prompts by Haiku as you send them.</Text>}
        {reqs.map(reqRow)}
      </Box>
    )

    // ----- activity -----
    const shown = events.filter(ev => {
      const f: Filter = view.filter
      if (f === 'all') return true
      if (f === 'code') return ev.kind === 'code'
      if (f === 'tests') return ev.kind === 'test'
      if (f === 'messages') return ev.kind === 'message'
      return ev.kind !== 'discovery' && ev.kind !== 'command'
    })
    const room = Math.max(6, (e.viewport?.rows ?? 40) - 24)
    const selected = events.find(ev => ev.id === view.selectedEvent)

    const composer = selected && (
      <Box flexDirection="column" paddingTop={1} paddingX={1} borderStyle="round" borderColor={p.lav}>
        <Text color={p.text3}>Replying to</Text>
        <Text color={p.text}>
          {chip(KIND[selected.kind].label, KIND[selected.kind].tone)} {hhmm(selected.at)} · {selected.title}
        </Text>
        {selected.detail && <Text color={p.text2}>{clip(selected.detail, 600)}</Text>}
        {selected.file && (
          <Box flexDirection="row" gap={1} paddingY={1}>
            <Text color={p.text3}>{base(selected.file)}</Text>
            {selected.kind === 'code' && editors.map(ed => (
              <Button key={`ed-${ed.name}`} label={`Diff in ${ed.name}`} onPress={() => openDiff($, selected, ed.name)} />
            ))}
            {selected.kind === 'code' && <Button key="ed-term" label="Diff in Terminal" onPress={() => openDiff($, selected, 'terminal')} />}
          </Box>
        )}
        {replies.filter(r => r.eventId === selected.id).map(r => (
          <Text key={`th-${r.id}`} color={p.text2}>
            <Text color={p.text3}>You {hhmm(r.at)}: </Text>{r.text} <Text color={r.delivery === 'failed' ? p.rose : p.text3}>({DELIVERY[r.delivery]})</Text>
          </Text>
        ))}
        <Select
          key="mode"
          label="Reply as"
          value={view.mode}
          options={[
            { value: 'comment', label: 'Comment only (agent does not see it)' },
            { value: 'requirement', label: 'Add or refine a requirement' },
            { value: 'redirect', label: 'Instruction to the agent' },
          ]}
          onSelect={v => setView({ mode: v as ReplyMode })}
        />
        {view.mode === 'requirement' && (
          <Select
            key="refines"
            label="Requirement"
            value={view.refines}
            options={[{ value: 'new', label: 'New requirement' }, ...reqs.map(r => ({ value: r.id, label: `Refines ${r.id}: ${clip(r.title, 50)}` }))]}
            onSelect={v => setView({ refines: v })}
          />
        )}
        {view.mode !== 'comment' && (
          <Button key="interrupt" label={`${view.interrupt ? '[x]' : '[ ]'} Interrupt the agent first`} plain onPress={() => setView({ interrupt: !view.interrupt })} />
        )}
        <Input key="reply" placeholder="Reply to this activity…" submitLabel="Send" onSubmit={text => (text.trim() ? sendReply($, selected, text.trim(), view) : undefined)} />
      </Box>
    )

    const activityTab = (
      <Box flexDirection="column">
        <Select
          key="filter"
          label="Show"
          value={view.filter}
          options={[
            { value: 'key', label: 'Key events' },
            { value: 'all', label: 'Everything' },
            { value: 'code', label: 'Code changes' },
            { value: 'tests', label: 'Tests' },
            { value: 'messages', label: 'Agent messages' },
          ]}
          onSelect={v => setView({ filter: v as Filter })}
        />
        {shown.length === 0 && <Text color={p.text3}>No activity yet.</Text>}
        {shown.slice(-room).reverse().map(ev => {
          const k = KIND[ev.kind]
          const n = replies.filter(r => r.eventId === ev.id).length
          const isSel = ev.id === view.selectedEvent
          return (
            <Box key={`evr-${ev.id}`} flexDirection="row" gap={1}>
              <Text color={p.text3}>{hhmm(ev.at)}</Text>
              <Text color={isSel ? p.lav : fg(p, k.tone)} bold={isSel}>{k.label}</Text>
              <Button key={`ev-${ev.id}`} label={clip(ev.title, 70)} plain onPress={() => setView({ selectedEvent: isSel ? undefined : ev.id })} />
              {ev.state === 'failed' && <Text color={p.rose}>failed</Text>}
              {ev.state === 'running' && <Text color={p.lav}>running</Text>}
              {n > 0 && <Text color={p.text3}>· {n} repl{n === 1 ? 'y' : 'ies'}</Text>}
            </Box>
          )
        })}
        {composer}
      </Box>
    )

    // ----- audit -----
    const gap = gapOf
    const open = live.filter(r => gap(r))
    const auditTab = (
      <Box flexDirection="column">
        <Text color={p.text}>
          Accounted for: {live.filter(r => r.status !== 'captured').length}/{live.length} · Verified: <Text color={p.lime}>{verified}/{live.length}</Text>
        </Text>
        <Text color={p.text3}>The agent saying something is done does not count. Verified needs a passing check or your acceptance.</Text>
        <Box flexDirection="column" paddingY={1}>
          {reqs.map(r => (
            <Text key={`a-${r.id}`} color={p.text}>
              {chip(r.needsReverify ? 'Re-verify' : STATUS[r.status].label, r.needsReverify ? 'amber' : STATUS[r.status].tone)} <Text color={p.text3}>{r.id}</Text> {clip(r.title, 60)}
              {gap(r) && <Text color={p.text3}> · {gap(r)}</Text>}
            </Text>
          ))}
        </Box>
        {open.length > 0 && (
          <Button
            key="close-gaps"
            variant="primary"
            onPress={async () => {
              await askGaps($)
              await $.ui.toast('Sent the open requirements to the agent.')
            }}
            label={`Ask agent to close ${open.length} gap${open.length === 1 ? '' : 's'}`}
          />
        )}
      </Box>
    )

    const cols = e.props.bodyColumns
    if (cols >= SIDE_BY_SIDE_AT) {
      // Wide: the mockup's layout, requirements | activity + reply | audit.
      const heading = (text: string) => <Text color={p.text2} bold>{text}</Text>
      const column = (key: string, width: number, title: string, body: RenderChildren) => (
        <Box key={key} flexDirection="column" width={width} paddingX={1} borderStyle="single" borderColor={p.border}>
          {heading(title)}
          {body}
        </Box>
      )
      const inner = cols - 4
      const side = Math.max(34, Math.floor(inner * 0.28))
      return (
        <Box flexDirection="column" padding={1} backgroundColor={p.bg}>
          <Box flexDirection="row" justifyContent="space-between">
            {header}
            <Button key="theme" label={view.dark ? 'Light mode' : 'Dark mode'} plain dimColor onPress={async () => { await setView({ dark: !view.dark }); await $.store.set('dark', !view.dark) }} />
          </Box>
          <Box flexDirection="row" gap={1}>
            {column('col-reqs', side, `Requirements (${reqs.length})`, reqsTab)}
            {column('col-activity', inner - side * 2 - 2, `Activity (${events.length})`, activityTab)}
            {column('col-audit', side, 'Completion audit', auditTab)}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={1} backgroundColor={p.bg}>
        {header}
        {tabs}
        {view.tab === 'reqs' ? reqsTab : view.tab === 'activity' ? activityTab : auditTab}
      </Box>
    )
  })
}
