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
  Theme,
  View,
} from '../types'
import { BACKFILL_SYSTEM, TAG_SYSTEM, backfillPrompt, parseBackfill, parseTagged, tagPrompt } from './tagging'
import type { PastPrompt, Tagged } from './tagging'
import { EDITORS, LINUX, MAC, WINDOWS, base, firstLine, join, launchCommand } from './platform'
import type { Editor, OS, Platform, Terminal } from './platform'
import {
  DEFAULT_THEME, IMPORT_SYSTEM, PRESETS, colourLines, normalizeTheme, ownThemeFile, pageParts, palette, sourceKind, themeFromReply, toneBg, toneFg,
} from './theme'
import type { Tone } from './theme'

type $T = EngineInterface

const PANE = 'ledger'
const TOOL = 'mcp__praetorium__ledger'
const HAIKU = 'claude-haiku-5-5'
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

const reqsA = atom({ plugin: 'praetorium', key: 'reqs' } as const, [] as Requirement[])
const eventsA = atom({ plugin: 'praetorium', key: 'events' } as const, [] as ActivityEvent[])
const repliesA = atom({ plugin: 'praetorium', key: 'replies' } as const, [] as Reply[])
const viewA = atom({ plugin: 'praetorium', key: 'view' } as const, DEFAULT_VIEW)
const turnA = atom({ plugin: 'praetorium', key: 'turnId' } as const, '')
const inboxSeqA = atom({ plugin: 'praetorium', key: 'inboxSeq' } as const, 0)
const titleA = atom({ plugin: 'praetorium', key: 'title' } as const, '')
const themeA = atom({ plugin: 'praetorium', key: 'theme' } as const, DEFAULT_THEME)

const STATUS: Record<ReqStatus, { label: string; tone: Tone }> = {
  captured: { label: 'Not started', tone: 'muted' },
  in_progress: { label: 'In progress', tone: 'active' },
  implemented: { label: 'Implemented · not verified', tone: 'warn' },
  verified: { label: 'Verified', tone: 'done' },
  blocked: { label: 'Blocked', tone: 'danger' },
  needs_clarification: { label: 'Needs clarification', tone: 'warn' },
  deferred: { label: 'Deferred', tone: 'muted' },
}

const KIND: Record<EventKind, { label: string; tone: Tone }> = {
  discovery: { label: 'Discovery', tone: 'muted' },
  plan: { label: 'Plan', tone: 'active' },
  code: { label: 'Code change', tone: 'active' },
  command: { label: 'Command', tone: 'muted' },
  test: { label: 'Test', tone: 'warn' },
  message: { label: 'Agent message', tone: 'active' },
}

const DELIVERY: Record<Delivery, string> = {
  kept: 'Comment · not sent to agent',
  queued: 'Queued · goes with your next prompt',
  received: 'Received by agent',
  acted: 'Agent finished a turn after receiving it',
  failed: 'Not delivered',
}

// Found on the machine at session start; module state is fine because
// session.start runs again on every reload.
let plat: Platform = { os: 'mac', tmp: '/tmp/praetorium', node: '', editors: [] }
let storeKey = ''
let sessionId = ''
let project = ''
let hasEnded = false
const stateFile = () => join(plat.tmp, `state-${sessionId}.json`)
const inboxFile = () => join(plat.tmp, `inbox-${sessionId}.jsonl`)
const snapOf = (ev: ActivityEvent) => join(plat.tmp, `${ev.id}-${base(ev.file ?? '')}`)
const viewerArgs = (...rest: string[]) => [plat.node, join($root, 'viewer/ledger-view.mjs'), ...rest]
let $root = ''

const now = () => Date.now()
const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const nextId = (reqs: Requirement[]) => `R${reqs.length + 1}`
const uid = () => `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// The terminal window reads this file; it holds nothing the session state doesn't.
async function mirror($: $T) {
  if (!sessionId) return
  try {
    const [reqs, replies, events, turnId, title, theme, view] = await Promise.all([
      read($, reqsA), read($, repliesA), read($, eventsA), read($, turnA), read($, titleA), read($, themeA), read($, viewA),
    ])
    await $.fs.write(stateFile(), JSON.stringify({
      sessionId, project, title, hasEnded,
      reqs, replies, events: events.slice(-200), isWorking: Boolean(turnId) && !hasEnded, editors: plat.editors, snapDir: plat.tmp, theme, dark: view.dark, at: now(),
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

async function tag($: $T, text: string, reqs: Requirement[]): Promise<Tagged[]> {
  const lastReply = [...(await read($, eventsA))].reverse().find(ev => ev.kind === 'message')?.detail ?? ''
  const res = await $.model.complete({ model: HAIKU, system: TAG_SYSTEM, prompt: tagPrompt(reqs, text, lastReply) })
  return res.isAnswered ? parseTagged(res.text) : []
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

function describe(e: Record<string, unknown>, when?: number): ActivityEvent | undefined {
  const tool = String(e.tool)
  const id = String(e.tool_use_id)
  const at = when ?? now()
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
    await $.fs.write(snapOf(ev), text)
  } catch {
    // no snapshot: the diff button falls back to opening the file
  }
}

async function openDiff($: $T, ev: ActivityEvent, how: string) {
  if (!ev.file) return
  const snap = snapOf(ev)
  const hasSnap = await $.fs.exists(snap).catch(() => false)
  if (how === 'terminal') {
    const term = await chosenTerminal($)
    if (!term || !plat.node) return void $.ui.toast('No terminal or Node found for the diff.')
    const err = await openIn($, term, viewerArgs('--diff', hasSnap ? snap : '', ev.file), 'Praetorium diff')
    if (err) await $.ui.toast(`Could not open the diff: ${err}`)
    return
  }
  const ed = plat.editors.find(x => x.name === how)
  if (!ed) return
  // Editor CLIs on Windows are .cmd scripts, which need the shell.
  const argv = hasSnap ? [ed.bin, '--diff', snap, ev.file] : [ed.bin, '-g', ev.file]
  await $.process.run(plat.os === 'windows' ? ['cmd', '/c', ...argv] : argv)
}

// ---------- the machine: OS, Node, editors, terminals ----------

async function run($: $T, argv: string[]) {
  try {
    return await $.process.run(argv, { timeoutMs: 8000 })
  } catch {
    return undefined
  }
}

// Finds a command on PATH the way the person's own shell would.
async function which($: $T, os: OS, name: string): Promise<string> {
  if (os === 'windows') {
    const r = await run($, ['where', name])
    return r?.exitCode === 0 ? firstLine(r.stdout) : ''
  }
  // A login shell first, then an interactive one: nvm and friends often live in .zshrc / .bashrc.
  const shell = (await $.env.get('SHELL')) || '/bin/zsh'
  for (const flags of ['-lc', '-ilc']) {
    const r = await run($, [shell, flags, `command -v ${name}`])
    const found = r?.exitCode === 0 ? firstLine(r.stdout.trim().split('\n').pop()) : ''
    if (found.startsWith('/')) return found
  }
  return ''
}

// Apps started from the Dock or Start menu (the desktop app) get a minimal PATH,
// so after PATH, look where Node installers put it.
async function findNode($: $T, os: OS): Promise<string> {
  const onPath = await which($, os, 'node')
  if (onPath) return onPath
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const fixed = os === 'windows'
    ? ['C:/Program Files/nodejs/node.exe', join(home, 'AppData/Roaming/nvm/current/node.exe'), join(home, '.volta/bin/node.exe')]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', join(home, '.volta/bin/node'), join(home, '.local/share/mise/shims/node'), join(home, '.asdf/shims/node')]
  for (const bin of fixed) if (await $.fs.exists(bin).catch(() => false)) return bin
  // nvm: the newest installed version
  const nvm = join(home, '.nvm/versions/node')
  const versions = (await $.fs.list(nvm).catch(() => []))
    .map(v => v.name)
    .filter(v => /^v\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const pa = a.slice(1).split('.').map(Number)
      const pb = b.slice(1).split('.').map(Number)
      return (pb[0]! - pa[0]!) || (pb[1]! - pa[1]!) || (pb[2]! - pa[2]!)
    })
  for (const v of versions) {
    const bin = join(nvm, v, 'bin/node')
    if (await $.fs.exists(bin).catch(() => false)) return bin
  }
  return ''
}

async function detect($: $T): Promise<Platform> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const os: OS = isWindows ? 'windows' : firstLine((await run($, ['uname', '-s']))?.stdout) === 'Darwin' ? 'mac' : 'linux'
  const tmpRoot = isWindows
    ? (await $.env.get('TEMP')) || (await $.env.get('TMP')) || 'C:/Windows/Temp'
    : (await $.env.get('TMPDIR')) || '/tmp'
  const editors: Editor[] = []
  for (const [name, cmd, macBin] of EDITORS) {
    const bin = os === 'mac' && (await $.fs.exists(macBin).catch(() => false)) ? macBin : await which($, os, cmd)
    if (bin) editors.push({ name, bin })
  }
  return { os, tmp: join(tmpRoot, 'praetorium'), node: await findNode($, os), editors }
}

async function installedTerminals($: $T): Promise<Terminal[]> {
  const found: Terminal[] = []
  if (plat.os === 'mac') {
    for (const t of MAC) if (await $.fs.exists(t.app).catch(() => false)) found.push({ id: t.id, name: t.name })
    return found
  }
  for (const t of plat.os === 'windows' ? WINDOWS : LINUX) {
    if (t.id === 'cmd' || (await which($, plat.os, t.cmd))) found.push({ id: t.id, name: t.name })
  }
  return found
}

// Opens `argv` in a new window of `term`. Resolves an error message, or '' on success.
async function openIn($: $T, term: Terminal, argv: string[], title: string): Promise<string> {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const launch = launchCommand(plat.os, term, argv, title, home)
  if (!launch) return `unknown terminal ${term.id}`
  if (launch.file) await $.fs.write(launch.file.path, launch.file.text)
  const r = await run($, launch.cmd)
  if (!r) return `could not start ${term.name}`
  return r.exitCode === 0 ? '' : r.stderr.trim() || `${term.name} exited with ${r.exitCode}`
}

// ---------- importing a theme ----------

async function readThemeSource($: $T, from: string): Promise<string> {
  if (!/^https?:\/\//i.test(from)) {
    const text = String(await $.fs.read(from))
    return /\.json$/i.test(from) ? text.slice(0, 24_000) : colourLines(text)
  }
  const page = await $.http.fetch(from)
  if (!page.ok) throw new Error(`${from} answered ${page.status}`)
  const { inline, stylesheets } = pageParts(page.text, from)
  const sheets: string[] = []
  for (const href of stylesheets) {
    const res = await $.http.fetch(href).catch(() => undefined)
    if (res?.ok) sheets.push(res.text)
  }
  return colourLines([...inline, ...sheets].join('\n'))
}

async function importTheme($: $T, from: string): Promise<Theme> {
  if (/\.json$/i.test(from) && !/^https?:/i.test(from)) {
    const own = ownThemeFile(String(await $.fs.read(from)))
    if (own) return own
  }
  const text = await readThemeSource($, from)
  if (!text.trim()) throw new Error(`found no colours in ${from}`)
  const res = await $.model.complete({ model: HAIKU, system: IMPORT_SYSTEM, prompt: `Source: ${sourceKind(from)}\n\n${text}` })
  if (!res.isAnswered) throw new Error(`the model did not answer (${res.reason})`)
  return themeFromReply(res.text)
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

async function chosenTerminal($: $T, wanted?: string): Promise<Terminal | undefined> {
  const found = await installedTerminals($)
  const pref = wanted || String((await $.store.get('terminal').catch(() => '')) ?? '')
  return found.find(t => t.id === pref.toLowerCase() || t.name.toLowerCase() === pref.toLowerCase()) ?? found[0]
}

async function openWindow($: $T, wanted: string): Promise<string> {
  if (!plat.node) return 'Node.js was not found on this machine. Install Node 18 or newer, then try again.'
  const found = await installedTerminals($)
  const term = await chosenTerminal($, wanted)
  if (!term) return 'No supported terminal app was found.'
  if (wanted && term.id !== wanted.toLowerCase()) {
    return `${wanted} isn't installed or isn't supported. Installed: ${found.map(t => t.id).join(', ')}.`
  }
  if (wanted) await $.store.set('terminal', term.id)
  await mirror($)
  // One window for every session: if it's open (fresh heartbeat), switch it here instead.
  const beat = Number(await $.fs.read(join(plat.tmp, 'viewer.alive')).catch(() => '0'))
  if (!wanted && now() - beat < 3000) {
    await $.fs.write(join(plat.tmp, 'viewer.focus'), sessionId)
    return 'The Praetorium window is already open; it now shows this session. (/ledger window <terminal> opens another.)'
  }
  const err = await openIn($, term, viewerArgs(plat.tmp, sessionId), 'Praetorium')
  return err
    ? `Could not open ${term.name}: ${err}`
    : `Praetorium opened in ${term.name}.${found.length > 1 ? ` Others: ${found.filter(t => t !== term).map(t => t.id).join(', ')} (/ledger window <name>).` : ''}`
}

// ---------- themes ----------

async function setTheme($: $T, theme: Theme) {
  await update($, themeA, () => theme)
  await $.store.set('theme', theme)
  await mirror($)
}

async function themeCommand($: $T, arg: string): Promise<string> {
  const [verb = '', ...rest] = arg.split(/\s+/).filter(Boolean)
  const presets = Object.keys(PRESETS).join(', ')
  if (!verb) {
    const t = await read($, themeA)
    return `Theme: ${t.name}. Presets: ${presets}. /ledger theme <preset>, or /ledger theme import <url | tailwind.config.js | file.css | theme.json>.`
  }
  if (verb === 'import') {
    const from = rest.join(' ')
    if (!from) return 'Give a website URL or a file path: /ledger theme import https://example.com'
    try {
      const theme = await importTheme($, from)
      await setTheme($, theme)
      return `Imported theme "${theme.name}" from ${from}. Colours too faint to read were replaced with defaults.`
    } catch (err) {
      return `Could not import a theme from ${from}: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  const preset = PRESETS[verb]
  if (!preset) return `No preset "${verb}". Presets: ${presets}.`
  await setTheme($, preset)
  return `Theme set to ${verb}.`
}

// ---------- sessions from before Praetorium: their transcripts ----------

// Transcripts hold everything a person typed, so nothing reads them without a yes,
// asked once in a dialog and remembered ('allowed' | 'declined').
const CONSENT_PANE = 'praetorium-consent'

type PastSession = {
  sessionId: string
  cwd: string
  title: string
  firstAt: number
  lastAt: number
  prompts: PastPrompt[]
  tools: Record<string, unknown>[]
  replies: { at: number; text: string }[]
}

const transcriptsAllowed = async ($: $T) => (await $.store.get('transcripts').catch(() => undefined)) === 'allowed'

async function projectsDir($: $T): Promise<string> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || join((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '', '.claude')
  return join(config, 'projects')
}

// Runs viewer/import.mjs, which streams the transcripts and keeps only what the ledger needs.
async function readPast($: $T, args: string[]): Promise<PastSession[]> {
  if (!plat.node) throw new Error('Node.js was not found')
  const out = join(plat.tmp, `import-${sessionId}.json`)
  const r = await $.process.run([plat.node, join($root, 'viewer/import.mjs'), await projectsDir($), out, ...args], { timeoutMs: 120_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `import exited with ${r.exitCode}`)
  return JSON.parse(String(await $.fs.read(out))) as PastSession[]
}

// One Haiku call turns a whole past conversation into requirements; tool calls become events.
async function ledgerOf($: $T, past: PastSession): Promise<{ reqs: Requirement[]; events: ActivityEvent[] }> {
  const res = await $.model.complete({ model: HAIKU, system: BACKFILL_SYSTEM, prompt: backfillPrompt(past.prompts) })
  const items = res.isAnswered ? parseBackfill(res.text, past.prompts.length) : []
  const reqs: Requirement[] = []
  const byOwnId = new Map<string, string>()
  for (const item of items) {
    const at = past.prompts[item.msg - 1]?.at ?? past.firstAt
    const target = item.refines ? reqs.find(r => r.id === byOwnId.get(item.refines ?? '')) : undefined
    if (target) {
      target.history.push({ at, text: item.quote || item.title, kind: 'refinement', by: 'you' })
      byOwnId.set(item.id, target.id)
      continue
    }
    const id = `R${reqs.length + 1}`
    byOwnId.set(item.id, id)
    reqs.push({ id, title: item.title, status: 'captured', at, history: [{ at, text: item.quote || item.title, kind: 'original', by: 'you' }], evidence: [] })
  }
  const events: ActivityEvent[] = []
  for (const t of past.tools) {
    const ev = describe(t, Number(t.at) || past.lastAt)
    if (!ev) continue
    if (ev.state === 'running') ev.state = t.isError ? 'failed' : 'ok'
    events.push(ev)
  }
  for (const [i, m] of past.replies.entries()) {
    events.push({ id: `m-${past.sessionId}-${i}`, kind: 'message', at: m.at, title: clip(m.text.split('\n')[0] ?? '', 90), detail: m.text })
  }
  events.sort((a, b) => a.at - b.at)
  return { reqs, events: events.slice(-200) }
}

async function importSessions($: $T, days: number): Promise<string> {
  const existing = (await $.fs.list(plat.tmp).catch(() => []))
    .map(f => /^state-(.+)\.json$/.exec(f.name)?.[1])
    .filter((x): x is string => Boolean(x))
  const past = await readPast($, ['--days', String(days), '--max', '12', '--skip', [...existing, sessionId].join(',')])
  const [theme, view] = await Promise.all([read($, themeA), read($, viewA)])
  let tagged = 0
  // A few at a time: one Haiku call each.
  for (let i = 0; i < past.length; i += 4) {
    await Promise.all(past.slice(i, i + 4).map(async s => {
      const { reqs, events } = await ledgerOf($, s)
      tagged += reqs.length
      await $.fs.write(join(plat.tmp, `state-${s.sessionId}.json`), JSON.stringify({
        sessionId: s.sessionId, project: base(s.cwd), title: s.title || clip(s.prompts[0]?.text ?? '', 70),
        imported: true, hasEnded: false, isWorking: false,
        reqs, replies: [], events, editors: plat.editors, snapDir: plat.tmp, theme, dark: view.dark, at: s.lastAt,
      }))
    }))
  }
  return past.length
    ? `Imported ${past.length} session${past.length === 1 ? '' : 's'} from the last ${days} day${days === 1 ? '' : 's'} (${tagged} requirements). They show in /ledger window, read-only until reopened.`
    : `No sessions from the last ${days} day${days === 1 ? '' : 's'} left to import.`
}

// A session reopened after Praetorium was installed starts from its own transcript.
async function backfillSelf($: $T) {
  if (!(await transcriptsAllowed($)) || (await read($, reqsA)).length) return
  try {
    const [past] = await readPast($, ['--session', sessionId])
    if (!past?.prompts.length) return
    const { reqs, events } = await ledgerOf($, past)
    if ((await read($, reqsA)).length) return // the person sent a prompt meanwhile; keep its ids
    await update($, reqsA, () => reqs)
    await update($, eventsA, list => [...events, ...list].slice(-300))
    if (!(await read($, titleA))) await update($, titleA, () => past.title || clip(past.prompts[0]?.text ?? '', 70))
    await save($)
  } catch {
    // no transcript yet, or it could not be read: start empty
  }
}

async function importCommand($: $T, arg: string): Promise<string> {
  if (arg === 'allow') {
    await $.store.set('transcripts', 'allowed')
    void $.ui.close({ id: CONSENT_PANE }).catch(() => undefined)
    return `Allowed. ${await importSessions($, 2)}`
  }
  if (arg === 'revoke') {
    await $.store.set('transcripts', 'declined')
    return 'Praetorium will not read transcripts. Sessions already imported stay until your temp folder is cleared.'
  }
  if (!(await transcriptsAllowed($))) {
    await $.ui.open({ id: CONSENT_PANE, title: 'Praetorium', focus: true })
    return 'Praetorium needs your permission to read existing transcripts: answer in the dialog, or run /ledger import allow.'
  }
  const days = Math.min(30, Math.max(1, Number.parseInt(arg, 10) || 2))
  return importSessions($, days)
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
      const theme = await $.store.get('theme')
      if (theme) await update($, themeA, () => normalizeTheme(theme))
    } catch {
      // fresh session state
    }
    $root = $.plugin.root
    plat = await detect($).catch(() => plat)
    if ((await read($, reqsA)).length === 0) {
      // Imported earlier while this session wasn't running Praetorium: take it over.
      const imported = await $.fs.read(stateFile()).then(t => JSON.parse(t) as { imported?: boolean; reqs?: Requirement[]; events?: ActivityEvent[]; title?: string }).catch(() => undefined)
      if (imported?.imported) {
        await update($, reqsA, () => imported.reqs ?? [])
        await update($, eventsA, () => imported.events ?? [])
        if (imported.title) await update($, titleA, () => imported.title ?? '')
      } else {
        $.clock.after(0, () => void backfillSelf($))
      }
    }
    if ((await $.store.get('transcripts').catch(() => undefined)) === undefined) void $.ui.open({ id: CONSENT_PANE, title: 'Praetorium', focus: true })
    $.clock.every(700, () => void pollInbox($).catch(() => undefined))
    await mirror($)
    await $.tool.register({ name: 'ledger', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'ledger', description: 'Open the requirements ledger pane', argumentHint: '[window [terminal] | theme … | import [days | allow | revoke] | wide | narrow]' })
    void openPane($)
    return next(e)
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const raw = e.args.trim()
    const arg = raw.toLowerCase()
    if (arg === 'window' || arg.startsWith('window ')) return { text: await openWindow($, raw.slice(6).trim()) }
    if (arg === 'theme' || arg.startsWith('theme ')) return { text: await themeCommand($, raw.slice(5).trim()) }
    if (arg === 'import' || arg.startsWith('import ')) return { text: await importCommand($, arg.slice(6).trim()) }
    if (arg === 'wide' || arg === 'narrow') await $.store.set('width', arg)
    const width = await openPane($)
    return { text: `Ledger opened (${width}). /ledger window opens it in your terminal; /ledger theme changes the colours; /ledger wide or /ledger narrow resizes this pane; dragging the pane edge also works.` }
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
    // Recording is best effort: a reload can unload this plugin mid-call, and the
    // person's tool call must never fail because of the ledger.
    try {
      if (ev.kind === 'code') await snapshot($, ev)
      await pushEvent($, ev)
    } catch {
      // not recorded
    }
    const ran = await next(e)
    if (ev.state === 'running') {
      await patchEvent($, ev.id, { state: ran.deny !== undefined || ran.isError === true ? 'failed' : 'ok' }).catch(() => undefined)
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

  on('ui.render', { component: 'Pane', requestId: CONSENT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = palette(await read($, themeA), (await read($, viewA)).dark)
    const answer = async (choice: 'allowed' | 'declined') => {
      await $.store.set('transcripts', choice)
      await $.ui.close({ id: CONSENT_PANE })
      if (choice === 'allowed') {
        void backfillSelf($)
        await $.ui.toast(await importSessions($, 2))
      }
    }
    return (
      <Box flexDirection="column" padding={1} gap={1} backgroundColor={p.bg}>
        <Text color={p.text} bold>Show sessions you started before Praetorium?</Text>
        <Text color={p.text2}>
          Praetorium can read the Claude Code transcripts on this computer (~/.claude/projects) from the last 2 days, so earlier sessions appear in the ledger.
        </Text>
        <Text color={p.text2}>
          It reads your prompts, the names and file paths of the agent's tool calls, and its replies. File contents are not kept. Each session costs one Claude Haiku call to list its requirements. Nothing is written to the transcripts.
        </Text>
        <Text color={p.text3}>Change this any time with /ledger import allow or /ledger import revoke.</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="consent-allow" label="Allow" variant="primary" onPress={() => answer('allowed')} />
          <Button key="consent-decline" label="Not now" onPress={() => answer('declined')} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === "mobile") {
      const { Text } = $.ui.resolve(e)
      return <Text>Open the ledger on desktop.</Text>
    }
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const [reqs, events, replies, view] = await Promise.all([read($, reqsA), read($, eventsA), read($, repliesA), read($, viewA)])
    const p = palette(await read($, themeA), view.dark)
    const setView = (patch: Partial<View>) => update($, viewA, v => ({ ...v, ...patch }))
    const chip = (label: string, tone: Tone) => (
      <Text color={toneFg(p, tone)} backgroundColor={toneBg(p, tone)}> {label} </Text>
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
          {live.length} requirements · <Text color={p.done}>{verified} verified</Text> · {live.length - verified} open
        </Text>
      </Box>
    )

    // ----- requirements -----
    const reqRow = (r: Requirement) => (
      <Box key={`r-${r.id}`} flexDirection="column" paddingY={0}>
        <Box flexDirection="row" gap={1}>
          {chip(r.needsReverify ? 'Needs re-verification' : STATUS[r.status].label, r.needsReverify ? 'warn' : STATUS[r.status].tone)}
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
              <Text key={`e-${i}`} color={ev.kind === 'test' || ev.kind === 'manual' ? p.done : p.text2}>
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
      <Box flexDirection="column" paddingTop={1} paddingX={1} borderStyle="round" borderColor={p.active}>
        <Text color={p.text3}>Replying to</Text>
        <Text color={p.text}>
          {chip(KIND[selected.kind].label, KIND[selected.kind].tone)} {hhmm(selected.at)} · {selected.title}
        </Text>
        {selected.detail && <Text color={p.text2}>{clip(selected.detail, 600)}</Text>}
        {selected.file && (
          <Box flexDirection="row" gap={1} paddingY={1}>
            <Text color={p.text3}>{base(selected.file)}</Text>
            {selected.kind === 'code' && plat.editors.map(ed => (
              <Button key={`ed-${ed.name}`} label={`Diff in ${ed.name}`} onPress={() => openDiff($, selected, ed.name)} />
            ))}
            {selected.kind === 'code' && <Button key="ed-term" label="Diff in Terminal" onPress={() => openDiff($, selected, 'terminal')} />}
          </Box>
        )}
        {replies.filter(r => r.eventId === selected.id).map(r => (
          <Text key={`th-${r.id}`} color={p.text2}>
            <Text color={p.text3}>You {hhmm(r.at)}: </Text>{r.text} <Text color={r.delivery === 'failed' ? p.danger : p.text3}>({DELIVERY[r.delivery]})</Text>
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
              <Text color={isSel ? p.active : toneFg(p, k.tone)} bold={isSel}>{k.label}</Text>
              <Button key={`ev-${ev.id}`} label={clip(ev.title, 70)} plain onPress={() => setView({ selectedEvent: isSel ? undefined : ev.id })} />
              {ev.state === 'failed' && <Text color={p.danger}>failed</Text>}
              {ev.state === 'running' && <Text color={p.active}>running</Text>}
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
          Accounted for: {live.filter(r => r.status !== 'captured').length}/{live.length} · Verified: <Text color={p.done}>{verified}/{live.length}</Text>
        </Text>
        <Text color={p.text3}>The agent saying something is done does not count. Verified needs a passing check or your acceptance.</Text>
        <Box flexDirection="column" paddingY={1}>
          {reqs.map(r => (
            <Text key={`a-${r.id}`} color={p.text}>
              {chip(r.needsReverify ? 'Re-verify' : STATUS[r.status].label, r.needsReverify ? 'warn' : STATUS[r.status].tone)} <Text color={p.text3}>{r.id}</Text> {clip(r.title, 60)}
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
