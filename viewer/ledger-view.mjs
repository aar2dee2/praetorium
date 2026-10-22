// The Ledger in its own terminal window, for every Claude Code session running the mod.
// No dependencies. Reads the state-<session>.json files the mod writes; sends what
// you do back through that session's inbox-<session>.jsonl.
// Usage: node ledger-view.mjs [dir] [session-id to select first]
//        node ledger-view.mjs --diff <snapshot or ''> <file>

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'

if (process.argv[2] === '--diff') {
  showDiff(process.argv[3], process.argv[4])
  process.exit(0)
}

const dir = process.argv[2] || path.join(os.tmpdir(), 'praetorium')
let cur = process.argv[3] ?? ''
const sessions = new Map() // id -> { state, mtime }
const WEEK = 7 * 24 * 3600 * 1000
const inboxFile = () => path.join(dir, `inbox-${cur}.jsonl`)

// Graphite, the default theme; a session's own theme replaces it.
const FALLBACK = {
  dark: {
    bg: '#0d0f12', surface: '#14171c', surface2: '#1c2027', border: '#2a2f38',
    text: '#e6e8eb', text2: '#a0a6b0', text3: '#6b7280',
    done: '#34d399', active: '#818cf8', warn: '#fbbf24', danger: '#f87171',
  },
  light: {
    bg: '#f8f9fb', surface: '#ffffff', surface2: '#f0f2f5', border: '#e3e6ea',
    text: '#111418', text2: '#3d434c', text3: '#6b7280',
    done: '#047857', active: '#4f46e5', warn: '#b45309', danger: '#b91c1c',
  },
}
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (fg, bg, a) => '#' + rgb(fg).map((c, i) => Math.round(rgb(bg)[i] + (c - rgb(bg)[i]) * a).toString(16).padStart(2, '0')).join('')

// Full colour where the terminal says it has it; the nearest of 256 elsewhere (Apple Terminal, older consoles).
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ||
  ['iTerm.app', 'WezTerm', 'ghostty', 'vscode', 'WarpTerminal'].includes(process.env.TERM_PROGRAM ?? '') ||
  Boolean(process.env.WT_SESSION || process.env.KITTY_WINDOW_ID)
function to256(hex) {
  const [r, g, b] = rgb(hex)
  const level = c => (c < 48 ? 0 : c < 115 ? 1 : Math.floor((c - 35) / 40))
  const cube = 16 + 36 * level(r) + 6 * level(g) + level(b)
  const grey = Math.round(((r + g + b) / 3 - 8) / 10)
  const greyIdx = 232 + Math.max(0, Math.min(23, grey))
  const dist = (x, y, z) => (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2
  const steps = [0, 95, 135, 175, 215, 255]
  const cubeRgb = [level(r), level(g), level(b)].map(l => steps[l])
  const greyVal = 8 + 10 * (greyIdx - 232)
  return dist(...cubeRgb) <= dist(greyVal, greyVal, greyVal) ? cube : greyIdx
}
const fgCode = hex => (TRUECOLOR ? `\x1b[38;2;${rgb(hex).join(';')}m` : `\x1b[38;5;${to256(hex)}m`)
const bgCode = hex => (TRUECOLOR ? `\x1b[48;2;${rgb(hex).join(';')}m` : `\x1b[48;5;${to256(hex)}m`)

const STATUS = {
  captured: ['Not started', 'muted'],
  in_progress: ['In progress', 'active'],
  implemented: ['Implemented, not verified', 'warn'],
  verified: ['Verified', 'done'],
  blocked: ['Blocked', 'danger'],
  needs_clarification: ['Needs clarification', 'warn'],
  deferred: ['Deferred', 'muted'],
}
const KIND = {
  discovery: ['Discovery', 'muted'],
  plan: ['Plan', 'active'],
  code: ['Code change', 'active'],
  command: ['Command', 'muted'],
  test: ['Test', 'warn'],
  message: ['Agent', 'active'],
}
const DELIVERY = {
  kept: 'comment, not sent',
  queued: 'queued for your next prompt',
  received: 'received by agent',
  acted: 'agent finished a turn after it',
  failed: 'not delivered',
}
const MODES = {
  comment: 'Comment (agent does not see it)',
  requirement: 'New requirement',
  refine: 'Refine requirement',
  redirect: 'Instruction to the agent',
}

const EMPTY = { reqs: [], events: [], replies: [], editors: [], isWorking: false, title: '', project: '' }
let S = EMPTY
let darkOverride = null // 'l' flips the session's own mode for this window
let focus = 'reqs' // 'sessions' | 'reqs' | 'activity'
let showAll = false
const sel = { sessions: 0, reqs: 0, activity: 0 }
let compose = null // { mode, text, interrupt, eventId, refines }
let flash = ''
let seq = Date.now()

// ---------- drawing ----------

const out = process.stdout
const isDark = () => darkOverride ?? S.dark ?? true
const pal = () => {
  const t = { ...(isDark() ? FALLBACK.dark : FALLBACK.light), ...((isDark() ? S.theme?.dark : S.theme?.light) ?? {}) }
  return { ...t, mutedDim: t.surface2, ...Object.fromEntries(['done', 'active', 'warn', 'danger'].map(k => [`${k}Dim`, mix(t[k], t.surface, 0.14)])) }
}
const tone = (t, dim) => (t === 'muted' ? (dim ? pal().mutedDim : pal().text3) : pal()[dim ? `${t}Dim` : t])

// A line is a list of segments: [text, fg, bg?, bold?]
const seg = (text, fg, bg, bold) => [String(text), fg, bg, bold]
const width = line => line.reduce((n, s) => n + [...s[0]].length, 0)

function paint(line, w, rowBg) {
  let left = w
  let str = ''
  for (const [text, fg, bg, bold] of line) {
    if (left <= 0) break
    const chars = [...text.replace(/[\n\r\t]/g, ' ')]
    const part = chars.length > left ? `${chars.slice(0, Math.max(0, left - 1)).join('')}…` : chars.join('')
    left -= [...part].length
    str += `${fgCode(fg ?? pal().text)}${bgCode(bg ?? rowBg)}${bold ? '\x1b[1m' : ''}${part}\x1b[22m`
  }
  return `${str}${bgCode(rowBg)}${' '.repeat(Math.max(0, left))}`
}

function wrap(text, w, fg, indent = '') {
  const lines = []
  for (const para of String(text).split('\n')) {
    let cur = ''
    for (const word of para.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length > w - indent.length && cur) {
        lines.push([seg(indent + cur, fg)])
        cur = word
      } else cur = (cur ? cur + ' ' : '') + word
    }
    lines.push([seg(indent + cur, fg)])
  }
  return lines
}

const hhmm = t => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const chip = (label, t) => seg(` ${label} `, tone(t), tone(t, true))

function gapOf(r) {
  if (r.needsReverify) return 'Changed after it was done; check it again'
  return {
    implemented: 'Agent says done; no passing check yet',
    captured: "Not in the agent's work yet",
    in_progress: 'Still in progress',
    blocked: 'Blocked',
    needs_clarification: 'Waiting on you',
  }[r.status] ?? ''
}

const shownEvents = () =>
  [...S.events].filter(e => showAll || (e.kind !== 'discovery' && e.kind !== 'command')).reverse()
const live = () => S.reqs.filter(r => r.status !== 'deferred')
const isVerified = r => r.status === 'verified' && !r.needsReverify

function sessionList() {
  return [...sessions.values()]
    .map(x => x.state)
    .filter(st => Date.now() - (st.at ?? 0) < WEEK)
    .sort((a, b) => Number(b.isWorking) - Number(a.isWorking) || (b.at ?? 0) - (a.at ?? 0))
}

function sessionLines(w) {
  const p = pal()
  const list = sessionList()
  const lines = [[seg(`SESSIONS  ${list.length}`, p.text2, undefined, true)], []]
  list.forEach(st => {
    const isCur = st.sessionId === cur
    const isSel = focus === 'sessions' && isCur
    const L = st.reqs.filter(r => r.status !== 'deferred')
    const v = L.filter(r => r.status === 'verified' && !r.needsReverify).length
    const dot = st.isWorking ? seg('● ', p.active) : st.imported ? seg('◌ ', p.text3) : st.hasEnded ? seg('· ', p.text3) : seg('○ ', p.text3)
    lines.push({ sel: isSel || isCur, line: [dot, seg(st.project || 'session', isCur ? p.text : p.text2, undefined, isCur)] })
    lines.push({ sel: isSel || isCur, line: [seg('  '), seg(st.title || 'No prompt yet', p.text3)] })
    lines.push({ sel: isSel || isCur, line: [seg('  '), seg(`${v}/${L.length} verified`, v === L.length && L.length ? p.done : p.text3)] })
    lines.push([])
  })
  if (!list.length) lines.push(...wrap('No sessions are running the ledger mod yet.', w, p.text3))
  return lines
}

function reqLines(w) {
  const p = pal()
  const lines = [[seg(`REQUIREMENTS  ${S.reqs.length}`, p.text2, undefined, true)], []]
  if (!S.reqs.length) lines.push(...wrap('Tagged from your prompts by Haiku as you send them.', w, p.text3))
  S.reqs.forEach((r, i) => {
    const [label, t] = r.needsReverify ? ['Re-verify', 'warn'] : STATUS[r.status]
    const isSel = focus === 'reqs' && i === sel.reqs
    lines.push({ sel: isSel, line: [seg(isSel ? '› ' : '  ', p.active), seg(`${r.id} `, p.text3), chip(label, t), seg(' '), seg(r.title, isSel ? p.text : p.text, undefined, isSel)] })
  })
  return lines
}

function activityLines(w) {
  const p = pal()
  const evs = shownEvents()
  const lines = [[seg(`ACTIVITY  ${S.events.length}`, p.text2, undefined, true), seg(showAll ? '  everything' : '  key events', p.text3)], []]
  if (!evs.length) lines.push([seg('No activity yet.', p.text3)])
  evs.forEach((ev, i) => {
    const [label, t] = KIND[ev.kind] ?? ['Event', 'muted']
    const isSel = focus === 'activity' && i === sel.activity
    const n = S.replies.filter(r => r.eventId === ev.id).length
    lines.push({
      sel: isSel,
      line: [
        seg(isSel ? '› ' : '  ', p.active), seg(`${hhmm(ev.at)} `, p.text3), seg(`${label} `, tone(t)),
        seg(ev.title, p.text, undefined, isSel),
        ...(ev.state === 'failed' ? [seg('  failed', p.danger)] : ev.state === 'running' ? [seg('  running', p.active)] : []),
        ...(n ? [seg(`  · ${n} repl${n === 1 ? 'y' : 'ies'}`, p.text3)] : []),
      ],
    })
  })
  return lines
}

function detailLines(w) {
  const p = pal()
  const lines = []
  if (focus === 'reqs') {
    const r = S.reqs[sel.reqs]
    if (r) {
      const [label, t] = r.needsReverify ? ['Needs re-verification', 'warn'] : STATUS[r.status]
      lines.push([seg(r.id + ' ', p.text3), chip(label, t)], ...wrap(r.title, w, p.text), [])
      for (const h of r.history) {
        lines.push([seg(`${hhmm(h.at)} ${h.kind === 'original' ? 'Asked' : 'Refined'}${h.by === 'agent' ? ' (agent)' : ''}`, p.text3)])
        lines.push(...wrap(`“${h.text}”`, w, p.text2, '  '))
      }
      lines.push([])
      if (!r.evidence.length) lines.push([seg('No evidence yet.', p.text3)])
      for (const e of r.evidence) {
        const good = e.kind === 'test' || e.kind === 'manual'
        lines.push(...wrap(`${e.kind === 'test' ? 'Passed: ' : e.kind === 'manual' ? 'Accepted by you: ' : 'Note: '}${e.text}`, w, good ? p.done : p.text2))
      }
      lines.push([], [seg('a', p.active, undefined, true), seg(' accept  ', p.text3), seg('d', p.active, undefined, true), seg(' defer  ', p.text3), seg('f', p.active, undefined, true), seg(' refine', p.text3)])
    }
  } else {
    const ev = shownEvents()[sel.activity]
    if (ev) {
      const [label, t] = KIND[ev.kind] ?? ['Event', 'muted']
      lines.push([chip(label, t), seg(`  ${hhmm(ev.at)}`, p.text3)], ...wrap(ev.title, w, p.text))
      if (ev.file) lines.push([seg(ev.file, p.text3)])
      if (ev.detail) lines.push([], ...wrap(ev.detail, w, p.text2).slice(0, 14))
      const thread = S.replies.filter(r => r.eventId === ev.id)
      if (thread.length) lines.push([])
      for (const r of thread) {
        lines.push([seg(`You ${hhmm(r.at)}`, p.text3), seg(`  ${DELIVERY[r.delivery]}`, r.delivery === 'failed' ? p.danger : r.delivery === 'kept' ? p.text3 : p.active)])
        lines.push(...wrap(r.text, w, p.text2, '  '))
      }
      lines.push([], [
        seg('c', p.active, undefined, true), seg(' comment  ', p.text3),
        seg('n', p.active, undefined, true), seg(' new requirement  ', p.text3),
        seg('i', p.active, undefined, true), seg(' instruct agent', p.text3),
      ])
      if (ev.kind === 'code' && ev.file) {
        lines.push([
          ...(S.editors[0] ? [seg('o', p.active, undefined, true), seg(` diff in ${S.editors[0].name}  `, p.text3)] : []),
          seg('t', p.active, undefined, true), seg(' diff here', p.text3),
        ])
      }
    }
  }
  // audit
  const L = live()
  const verified = L.filter(isVerified).length
  const gaps = L.filter(r => gapOf(r))
  lines.push([], [seg('COMPLETION AUDIT', p.text2, undefined, true)])
  lines.push([seg(`Accounted ${L.filter(r => r.status !== 'captured').length}/${L.length}`, p.text), seg('   '), seg(`Verified ${verified}/${L.length}`, p.done)])
  lines.push(...wrap("The agent saying it's done doesn't count: verified needs a passing check or your acceptance.", w, p.text3))
  for (const r of gaps) lines.push([seg(`${r.id} `, p.text3), seg(gapOf(r), p.warn)])
  if (gaps.length) lines.push([seg('g', p.active, undefined, true), seg(` ask agent to close ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`, p.text3)])
  return lines
}

function column(lines, w, h) {
  // Keep the selected row in view.
  const selAt = lines.findIndex(l => l && l.sel)
  const start = selAt >= h ? selAt - h + 3 : 0
  return lines.slice(start, start + h).map(l => (Array.isArray(l) ? { line: l } : l))
}

function render() {
  const p = pal()
  const W = out.columns || 120
  const H = out.rows || 40
  const L = live()
  const verified = L.filter(isVerified).length
  const rows = []
  rows.push({ line: [
    seg(' Ledger ', p.text, undefined, true),
    seg(` ${S.project || ''}${S.title ? ` · ${S.title}` : ''}`, p.text2),
    ...(S.imported ? [seg('  imported · read-only until reopened', p.warn)] : []),
    seg(`   ${L.length} requirements · `, p.text2), seg(`${verified} verified`, p.done), seg(` · ${L.length - verified} open`, p.text2),
    seg('   agent ', p.text3), S.isWorking ? seg('● working', p.active) : seg('○ idle', p.text3),
  ] })
  rows.push({ line: [] })

  const bodyH = H - 5
  const gutter = 3
  let cols
  if (W >= 140) {
    const ws = 26
    const rest = W - ws - gutter * 3
    const wl = Math.floor(rest * 0.3)
    const wm = Math.floor(rest * 0.37)
    const wr = rest - wl - wm
    cols = [[sessionLines(ws), ws], [reqLines(wl), wl], [activityLines(wm), wm], [detailLines(wr), wr]]
  } else if (W >= 110) {
    const wl = Math.floor((W - gutter * 2) * 0.3)
    const wm = Math.floor((W - gutter * 2) * 0.38)
    const wr = W - gutter * 2 - wl - wm
    cols = [[reqLines(wl), wl], [activityLines(wm), wm], [detailLines(wr), wr]]
  } else {
    const list = focus === 'reqs' ? reqLines(W) : activityLines(W)
    cols = [[[...list, [], ...detailLines(W)], W]]
  }
  const drawn = cols.map(([lines, w]) => [column(lines, w, bodyH), w])
  for (let y = 0; y < bodyH; y++) {
    const parts = drawn.map(([lines, w]) => {
      const l = lines[y]
      return paint(l ? l.line : [], w, l && l.sel ? p.surface2 : p.bg)
    })
    rows.push({ raw: parts.join(paint([], gutter, p.bg)) })
  }

  // footer
  let footer
  if (compose) {
    const mode = MODES[compose.mode] + (compose.mode === 'refine' ? ` ${compose.refines}` : '')
    footer = [
      chip(mode, compose.mode === 'comment' ? 'muted' : 'active'),
      ...(compose.mode === 'comment' ? [] : [seg('  '), compose.interrupt ? chip('interrupt first', 'danger') : seg('ctrl-t interrupt first', p.text3)]),
      seg('  › ', p.active), seg(compose.text + '▏', p.text),
    ]
  } else {
    footer = [seg(flash || 'tab switch column · ↑↓ move · [ ] session · v all/key events · g close gaps · l light/dark · q quit', flash ? p.active : p.text3)]
  }
  rows.push({ line: [] }, { line: [seg('─'.repeat(W), p.border)] }, { line: footer })

  out.write('\x1b[H' + rows.map(r => r.raw ?? paint(r.line, W, p.bg)).join('\r\n') + '\x1b[0m')
}

// ---------- state in, commands out ----------

function scan() {
  let changed = false
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => /^state-.+\.json$/.test(n))
  } catch {
    // no sessions yet
  }
  for (const name of names) {
    const file = path.join(dir, name)
    try {
      const mtime = fs.statSync(file).mtimeMs
      const id = name.slice(6, -5)
      if (sessions.get(id)?.mtime === mtime) continue
      sessions.set(id, { mtime, state: { ...EMPTY, sessionId: id, ...JSON.parse(fs.readFileSync(file, 'utf8')) } })
      changed = true
    } catch {
      // half-written: read it next scan
    }
  }
  if (!cur || !sessions.has(cur)) {
    const first = sessionList()[0]
    if (first) { cur = first.sessionId; changed = true }
  }
  if (changed) load()
}

function switchSession(step) {
  const list = sessionList()
  if (!list.length) return
  const i = Math.max(0, list.findIndex(st => st.sessionId === cur))
  cur = list[(i + step + list.length) % list.length].sessionId
  sel.reqs = 0
  sel.activity = 0
  load()
}

function load() {
  S = sessions.get(cur)?.state ?? EMPTY
  sel.reqs = Math.min(sel.reqs, Math.max(0, S.reqs.length - 1))
  sel.activity = Math.min(sel.activity, Math.max(0, shownEvents().length - 1))
  render()
}

function send(cmd, note) {
  if (!cur) return
  fs.appendFileSync(inboxFile(), JSON.stringify({ seq: ++seq, ...cmd }) + '\n')
  flash = note
  setTimeout(() => { flash = ''; render() }, 3000)
  render()
}

function openDiff(ev, here) {
  const snap = path.join(S.snapDir ?? dir, `${ev.id}-${path.basename(ev.file)}`)
  const hasSnap = fs.existsSync(snap)
  if (!here) {
    const ed = S.editors[0]
    if (!ed) return
    const args = hasSnap ? ['--diff', snap, ev.file] : ['-g', ev.file]
    spawn(ed.bin, args, { detached: true, stdio: 'ignore', shell: isWindows }).unref()
    flash = `Opened in ${ed.name}`
    return render()
  }
  out.write('\x1b[?1049l\x1b[?25h')
  process.stdin.setRawMode(false)
  showDiff(hasSnap ? snap : '', ev.file)
  process.stdin.setRawMode(true)
  out.write('\x1b[?1049h\x1b[?25l')
  render()
}

// ---------- keys ----------

function onKey(k) {
  if (compose) {
    if (k === '\x1b') compose = null
    else if (k === '\r') {
      const text = compose.text.trim()
      if (text) {
        const mode = compose.mode === 'refine' || compose.mode === 'requirement' ? 'requirement' : compose.mode
        send({ type: 'reply', eventId: compose.eventId, text, mode, refines: compose.refines ?? 'new', interrupt: compose.interrupt },
          mode === 'comment' ? 'Comment saved' : 'Sent to the session')
      }
      compose = null
    } else if (k === '\x7f') compose.text = [...compose.text].slice(0, -1).join('')
    else if (k === '\x14') compose.interrupt = !compose.interrupt
    else if (k === '\x15') compose.text = ''
    else if (!k.startsWith('\x1b')) compose.text += k.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f]/g, '')
    return render()
  }
  const evs = shownEvents()
  const ev = evs[sel.activity]
  const req = S.reqs[sel.reqs]
  // An imported session has no Praetorium running in it to receive anything.
  if (S.imported && 'cnfiadg'.includes(k)) {
    flash = 'This session was imported from its transcript. Reopen it in Claude Code to reply, accept or instruct.'
    setTimeout(() => { flash = ''; render() }, 4000)
    return render()
  }
  switch (k) {
    case 'q': case '\x03': return quit()
    case '\t': case '\x1b[C': {
      const order = (out.columns || 120) >= 140 ? ['sessions', 'reqs', 'activity'] : ['reqs', 'activity']
      focus = order[(order.indexOf(focus) + 1) % order.length]
      break
    }
    case '\x1b[D': {
      const order = (out.columns || 120) >= 140 ? ['sessions', 'reqs', 'activity'] : ['reqs', 'activity']
      focus = order[(order.indexOf(focus) - 1 + order.length) % order.length]
      break
    }
    case '[': return switchSession(-1)
    case ']': case 's': return switchSession(1)
    case '\x1b[A': case 'k': if (focus === 'sessions') return switchSession(-1); sel[focus] = Math.max(0, sel[focus] - 1); break
    case '\x1b[B': case 'j': if (focus === 'sessions') return switchSession(1); sel[focus] = Math.min((focus === 'reqs' ? S.reqs.length : evs.length) - 1, sel[focus] + 1); break
    case 'v': showAll = !showAll; sel.activity = 0; break
    case 'l': darkOverride = !isDark(); break
    case 'g': send({ type: 'gaps' }, 'Asked the agent to close the gaps'); return
    case 'a': if (focus === 'reqs' && req) return send({ type: 'accept', reqId: req.id }, `${req.id} accepted as verified`); break
    case 'd': if (focus === 'reqs' && req) return send({ type: 'defer', reqId: req.id }, `${req.id} deferred`); break
    case 'f': if (req) compose = { mode: 'refine', text: '', interrupt: false, eventId: focus === 'activity' ? ev?.id : undefined, refines: req.id }; break
    case 'c': case '\r': if (focus === 'activity' && ev) compose = { mode: 'comment', text: '', interrupt: false, eventId: ev.id }; break
    case 'n': if (ev || focus === 'reqs') compose = { mode: 'requirement', text: '', interrupt: false, eventId: focus === 'activity' ? ev?.id : undefined }; break
    case 'i': compose = { mode: 'redirect', text: '', interrupt: false, eventId: focus === 'activity' ? ev?.id : undefined }; break
    case 'o': if (focus === 'activity' && ev?.kind === 'code' && ev.file) return openDiff(ev, false); break
    case 't': if (focus === 'activity' && ev?.kind === 'code' && ev.file) return openDiff(ev, true); break
  }
  render()
}

function quit() {
  out.write('\x1b[0m\x1b[?25h\x1b[?1049l')
  process.exit(0)
}

out.write('\x1b[?1049h\x1b[?25l')
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', data => {
  // Arrow keys arrive as one escape sequence; pasted text as one chunk.
  const keys = compose ? (data.startsWith('\x1b[') ? [data] : data.length > 1 && !data.includes('\r') ? [data] : [...data]) : data.match(/\x1b\[[A-D]|[\s\S]/g) ?? []
  for (const k of keys) onKey(k)
})
out.on('resize', render)
process.on('SIGTERM', quit)
setInterval(scan, 500)
scan()
render()

function gitDiff(snap, file) {
  const args = snap
    ? ['--no-pager', 'diff', '--no-index', '--color=always', '--', snap, file]
    : ['--no-pager', '-C', path.dirname(file), 'diff', '--color=always', '--', file]
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.error) return `git was not found, so the diff cannot be shown.\n`
  return r.stdout || 'No changes.\n'
}

// Shows a diff in this terminal: through less where it exists, else printed with a key to close.
function showDiff(snap, file) {
  const text = gitDiff(snap, file)
  const canPage = !isWindows && process.env.TERM && process.env.TERM !== 'dumb'
  if (canPage && !spawnSync('less', ['-R'], { input: text, stdio: ['pipe', 'inherit', 'inherit'] }).error) return
  process.stdout.write(text + '\n\x1b[2mPress any key to close.\x1b[0m')
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    const buf = Buffer.alloc(8)
    try { fs.readSync(0, buf, 0, 8, null) } catch { /* closed */ }
    process.stdin.setRawMode(false)
  }
  process.stdout.write('\n')
}
