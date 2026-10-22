// The Ledger in its own terminal window, for every Claude Code session running the mod.
// No dependencies. Reads the state-<session>.json files the mod writes; sends what
// you do back through that session's inbox-<session>.jsonl.
// Usage: node ledger-view.mjs [dir] [session-id to select first]

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const dir = process.argv[2] ?? '/tmp/claude-ledger'
let cur = process.argv[3] ?? ''
const sessions = new Map() // id -> { state, mtime }
const WEEK = 7 * 24 * 3600 * 1000
const inboxFile = () => path.join(dir, `inbox-${cur}.jsonl`)

// Telborg tokens (telborg_news/design.md).
const PALETTE = {
  dark: {
    bg: '#0a0a0a', surface: '#121212', surface2: '#1f1f1f', border: '#292929',
    text: '#e2e8f0', text2: '#9d9d9d', text3: '#5d5d5d',
    lime: '#c3f73a', lav: '#af74fb', rose: '#f45286', amber: '#f5a623',
    limeDim: '#2b3218', lavDim: '#282033', roseDim: '#321b22', amberDim: '#322714', mutedDim: '#1f1f1f',
  },
  light: {
    bg: '#fafaf7', surface: '#ffffff', surface2: '#f1f1ec', border: '#e2e2dc',
    text: '#111111', text2: '#3f3f3f', text3: '#6a6a6a',
    lime: '#4a6b08', lav: '#6b21d4', rose: '#c81e5b', amber: '#a16207',
    limeDim: '#e9ede1', lavDim: '#ede4fa', roseDim: '#f8e4eb', amberDim: '#f4ece1', mutedDim: '#f1f1ec',
  },
}

const STATUS = {
  captured: ['Not started', 'muted'],
  in_progress: ['In progress', 'lav'],
  implemented: ['Implemented, not verified', 'amber'],
  verified: ['Verified', 'lime'],
  blocked: ['Blocked', 'rose'],
  needs_clarification: ['Needs clarification', 'amber'],
  deferred: ['Deferred', 'muted'],
}
const KIND = {
  discovery: ['Discovery', 'muted'],
  plan: ['Plan', 'lav'],
  code: ['Code change', 'lav'],
  command: ['Command', 'muted'],
  test: ['Test', 'amber'],
  message: ['Agent', 'lav'],
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
let dark = true
let focus = 'reqs' // 'sessions' | 'reqs' | 'activity'
let showAll = false
const sel = { sessions: 0, reqs: 0, activity: 0 }
let compose = null // { mode, text, interrupt, eventId, refines }
let flash = ''
let seq = Date.now()

// ---------- drawing ----------

const out = process.stdout
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(';')
const pal = () => (dark ? PALETTE.dark : PALETTE.light)
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
    str += `\x1b[38;2;${hex(fg ?? pal().text)}m\x1b[48;2;${hex(bg ?? rowBg)}m${bold ? '\x1b[1m' : ''}${part}\x1b[22m`
  }
  return `${str}\x1b[48;2;${hex(rowBg)}m${' '.repeat(Math.max(0, left))}`
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
    const dot = st.isWorking ? seg('● ', p.lav) : st.hasEnded ? seg('· ', p.text3) : seg('○ ', p.text3)
    lines.push({ sel: isSel || isCur, line: [dot, seg(st.project || 'session', isCur ? p.text : p.text2, undefined, isCur)] })
    lines.push({ sel: isSel || isCur, line: [seg('  '), seg(st.title || 'No prompt yet', p.text3)] })
    lines.push({ sel: isSel || isCur, line: [seg('  '), seg(`${v}/${L.length} verified`, v === L.length && L.length ? p.lime : p.text3)] })
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
    const [label, t] = r.needsReverify ? ['Re-verify', 'amber'] : STATUS[r.status]
    const isSel = focus === 'reqs' && i === sel.reqs
    lines.push({ sel: isSel, line: [seg(isSel ? '› ' : '  ', p.lav), seg(`${r.id} `, p.text3), chip(label, t), seg(' '), seg(r.title, isSel ? p.text : p.text, undefined, isSel)] })
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
        seg(isSel ? '› ' : '  ', p.lav), seg(`${hhmm(ev.at)} `, p.text3), seg(`${label} `, tone(t)),
        seg(ev.title, p.text, undefined, isSel),
        ...(ev.state === 'failed' ? [seg('  failed', p.rose)] : ev.state === 'running' ? [seg('  running', p.lav)] : []),
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
      const [label, t] = r.needsReverify ? ['Needs re-verification', 'amber'] : STATUS[r.status]
      lines.push([seg(r.id + ' ', p.text3), chip(label, t)], ...wrap(r.title, w, p.text), [])
      for (const h of r.history) {
        lines.push([seg(`${hhmm(h.at)} ${h.kind === 'original' ? 'Asked' : 'Refined'}${h.by === 'agent' ? ' (agent)' : ''}`, p.text3)])
        lines.push(...wrap(`“${h.text}”`, w, p.text2, '  '))
      }
      lines.push([])
      if (!r.evidence.length) lines.push([seg('No evidence yet.', p.text3)])
      for (const e of r.evidence) {
        const good = e.kind === 'test' || e.kind === 'manual'
        lines.push(...wrap(`${e.kind === 'test' ? 'Passed: ' : e.kind === 'manual' ? 'Accepted by you: ' : 'Note: '}${e.text}`, w, good ? p.lime : p.text2))
      }
      lines.push([], [seg('a', p.lav, undefined, true), seg(' accept  ', p.text3), seg('d', p.lav, undefined, true), seg(' defer  ', p.text3), seg('f', p.lav, undefined, true), seg(' refine', p.text3)])
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
        lines.push([seg(`You ${hhmm(r.at)}`, p.text3), seg(`  ${DELIVERY[r.delivery]}`, r.delivery === 'failed' ? p.rose : r.delivery === 'kept' ? p.text3 : p.lav)])
        lines.push(...wrap(r.text, w, p.text2, '  '))
      }
      lines.push([], [
        seg('c', p.lav, undefined, true), seg(' comment  ', p.text3),
        seg('n', p.lav, undefined, true), seg(' new requirement  ', p.text3),
        seg('i', p.lav, undefined, true), seg(' instruct agent', p.text3),
      ])
      if (ev.kind === 'code' && ev.file) {
        lines.push([
          ...(S.editors[0] ? [seg('o', p.lav, undefined, true), seg(` diff in ${S.editors[0].name}  `, p.text3)] : []),
          seg('t', p.lav, undefined, true), seg(' diff here', p.text3),
        ])
      }
    }
  }
  // audit
  const L = live()
  const verified = L.filter(isVerified).length
  const gaps = L.filter(r => gapOf(r))
  lines.push([], [seg('COMPLETION AUDIT', p.text2, undefined, true)])
  lines.push([seg(`Accounted ${L.filter(r => r.status !== 'captured').length}/${L.length}`, p.text), seg('   '), seg(`Verified ${verified}/${L.length}`, p.lime)])
  lines.push(...wrap("The agent saying it's done doesn't count: verified needs a passing check or your acceptance.", w, p.text3))
  for (const r of gaps) lines.push([seg(`${r.id} `, p.text3), seg(gapOf(r), p.amber)])
  if (gaps.length) lines.push([seg('g', p.lav, undefined, true), seg(` ask agent to close ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`, p.text3)])
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
    seg(`   ${L.length} requirements · `, p.text2), seg(`${verified} verified`, p.lime), seg(` · ${L.length - verified} open`, p.text2),
    seg('   agent ', p.text3), S.isWorking ? seg('● working', p.lav) : seg('○ idle', p.text3),
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
      chip(mode, compose.mode === 'comment' ? 'muted' : 'lav'),
      ...(compose.mode === 'comment' ? [] : [seg('  '), compose.interrupt ? chip('interrupt first', 'rose') : seg('ctrl-t interrupt first', p.text3)]),
      seg('  › ', p.lav), seg(compose.text + '▏', p.text),
    ]
  } else {
    footer = [seg(flash || 'tab switch column · ↑↓ move · [ ] session · v all/key events · g close gaps · l light/dark · q quit', flash ? p.lav : p.text3)]
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
  const snap = path.join(S.snapDir ?? '/tmp/claude-ledger', `${ev.id}-${path.basename(ev.file)}`)
  const hasSnap = fs.existsSync(snap)
  if (!here) {
    const ed = S.editors[0]
    if (!ed) return
    spawn(ed.bin, hasSnap ? ['--diff', snap, ev.file] : ['-g', ev.file], { detached: true, stdio: 'ignore' }).unref()
    flash = `Opened in ${ed.name}`
    return render()
  }
  out.write('\x1b[?1049l\x1b[?25h')
  process.stdin.setRawMode(false)
  const args = hasSnap ? ['--no-pager', 'diff', '--no-index', '--color=always', '--', snap, ev.file] : ['--no-pager', '-C', path.dirname(ev.file), 'diff', '--color=always', '--', ev.file]
  const diff = spawnSync('git', args, { encoding: 'utf8' })
  spawnSync('less', ['-R'], { input: diff.stdout || 'No changes.\n', stdio: ['pipe', 'inherit', 'inherit'] })
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
    case 'l': dark = !dark; break
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
