// Draws docs/dashboard.svg: the real terminal window, run on made-up demo sessions (no one's
// own data), turned from its terminal output into an SVG with numbered markers for the README.
//
//   bun scripts/screenshot.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COLS = 212
const ROWS = 34
const now = Date.now()
const min = (m: number) => now - m * 60_000

// ---------- demo sessions (the brief's worked example) ----------

const hist = (text: string, at: number, kind = 'original') => ({ at, text, kind, by: 'you' })
const reqs = [
  { id: 'R1', title: 'Show title, source and date on each result', status: 'verified', at: min(52), history: [hist('Show title, source, date', min(52))], evidence: [{ kind: 'test', at: min(9), text: 'npm test -- search-result', eventId: 't3' }] },
  { id: 'R2', title: 'Keep the existing tag colours', status: 'in_progress', at: min(52), needsReverify: true, conflict: { reason: 'the agent replaced the tag classes with new ones', at: min(30), source: 'agent' },
    history: [hist('use the existing tag colors', min(52)), hist('Please preserve the existing tag colors. Reuse the current classes rather than introducing new ones.', min(29), 'refinement')], evidence: [] },
  { id: 'R3', title: 'Show a one or two line summary', status: 'implemented', at: min(52), history: [hist('a short summary', min(52))], evidence: [] },
  { id: 'R4', title: 'Highlight matched keywords', status: 'in_progress', at: min(52), history: [hist('Highlight matching keywords', min(52))], evidence: [] },
  { id: 'R5', title: 'Make the layout more compact', status: 'captured', at: min(52), history: [hist('Make the layout more compact', min(52))], evidence: [] },
  { id: 'R6', title: 'Make sure it works on mobile', status: 'captured', at: min(52), history: [hist('ensure it works on mobile', min(52))], evidence: [] },
]
const ev = (id: string, kind: string, m: number, title: string, extra = {}) => ({ id, kind, at: min(m), title, ...extra })
const events = [
  ev('d1', 'discovery', 48, 'Read SearchResult.tsx'),
  ev('p1', 'plan', 46, 'Plan updated', { reqIds: ['R1', 'R2', 'R3', 'R4'], detail: '› [R1] Title, source, date\n· [R2] Tag colours\n· [R3] Summary\n· [R4] Highlight keywords' }),
  ev('c1', 'code', 31, 'Edited SearchResult.tsx', { file: 'components/search/SearchResult.tsx', state: 'ok', reqIds: ['R1', 'R2'] }),
  ev('m1', 'message', 30, "I've replaced the tag styling with a new set of CSS classes.", { detail: "I've replaced the tag styling with a new set of CSS classes to make the tags more compact.", reqIds: ['R1', 'R2'] }),
  ev('t1', 'test', 22, 'npm test -- search-result', { detail: 'npm test -- search-result', state: 'failed', reqIds: ['R2'] }),
  ev('c2', 'code', 15, 'Edited SearchResult.tsx', { file: 'components/search/SearchResult.tsx', state: 'ok', reqIds: ['R2', 'R3'] }),
  ev('t3', 'test', 9, 'npm test -- search-result', { detail: 'npm test -- search-result', state: 'ok', reqIds: ['R1', 'R2', 'R3'] }),
  ev('c3', 'code', 4, 'Edited highlight.ts', { file: 'lib/highlight.ts', state: 'running', reqIds: ['R4'] }),
]
const signals = [
  { id: 's1', kind: 'conflict', at: min(30), text: "The agent's work goes against R2: it replaced the tag classes with new ones.", eventId: 'm1', reqId: 'R2' },
  { id: 's2', kind: 'failed', at: min(22), text: 'Bash: 2 tests failed in search-result.test.tsx (tag colour snapshot).', eventId: 't1', reqId: 'R2',
    context: { ask: 'Please preserve the existing tag colors. Reuse the current classes rather than introducing new ones.', did: 'npm test -- search-result', output: '✕ renders tags with the existing colour classes\n  Expected class "tag-energy", received "chip chip--sm"\n2 failed, 14 passed' } },
  { id: 's3', kind: 'finding', at: min(14), text: 'The search API returns dates in UTC, so results near midnight show the wrong day.', eventId: 'c2' },
]
const plan = [
  { text: '[R1] Title, source and date', status: 'completed', reqIds: ['R1'] },
  { text: '[R2] Restore the existing tag classes', status: 'in_progress', reqIds: ['R2'] },
  { text: '[R3] Two-line summary', status: 'completed', reqIds: ['R3'] },
  { text: '[R4] Highlight matched keywords', status: 'in_progress', reqIds: ['R4'] },
]
const replies = [{ id: 'y1', eventId: 'm1', at: min(29), text: 'Please preserve the existing tag colors.', mode: 'requirement', delivery: 'acted', reqId: 'R2' }]

const base = { editors: [{ name: 'Cursor', bin: '/usr/bin/true' }], snapDir: '/nonexistent', dark: true, transcriptsAllowed: false, entry: 'claude-desktop', hasEnded: false }
const sessions = [
  { ...base, sessionId: 'demo-search', project: 'acme-web', title: 'Improve search results UI', isWorking: true, at: now, reqs, events, signals, plan, previews: [{ url: 'http://localhost:5173/search?q=energy', at: min(20), eventId: 'c1' }], replies },
  { ...base, sessionId: 'demo-unsub', project: 'acme-web', title: 'Fix newsletter unsubscribe bug', isWorking: false, at: min(60),
    reqs: [{ id: 'R1', title: 'Unsubscribe link works from every email', status: 'verified', at: min(90), history: [hist('fix the unsubscribe link', min(90))], evidence: [{ kind: 'manual', at: min(61), text: 'Checked and accepted' }] }], events: [], signals: [], plan: [], previews: [], replies: [] },
  { ...base, sessionId: 'demo-country', project: 'acme-api', title: 'Add country filter to news page', isWorking: false, at: min(200),
    reqs: [{ id: 'R1', title: 'Filter news by country', status: 'captured', at: min(210), history: [hist('add a country filter', min(210))], evidence: [] }], events: [], signals: [], plan: [], previews: [], replies: [] },
  { ...base, sessionId: 'demo-mobile', project: 'This computer', title: 'Improve mobile layout', isWorking: false, imported: true, at: min(900),
    reqs: [{ id: 'R1', title: 'Fix the nav on small screens', status: 'captured', at: min(950), history: [hist('fix mobile nav', min(950))], evidence: [] }], events: [], signals: [], plan: [], previews: [], replies: [] },
]

const dir = mkdtempSync(join(tmpdir(), 'principia-shot-'))
for (const s of sessions) {
  writeFileSync(join(dir, `state-${s.sessionId}.json`), JSON.stringify(s))
  if (!s.imported) writeFileSync(join(dir, `alive-${s.sessionId}`), String(now))
}
writeFileSync(join(dir, 'viewer.prefs.json'), JSON.stringify({ dark: true, showSessions: true, showHeadless: false }))

// ---------- run the real window and keep its last frame ----------

const out = join(dir, 'frame.txt')
const viewer = `bun viewer/cli.mjs view '${dir}' demo-search /nonexistent`
// The terminal's size comes from stty inside the pseudo-terminal, not from COLUMNS/LINES.
const inner = `stty cols ${COLS} rows ${ROWS}; exec ${viewer}`
const r = Bun.spawnSync(['bash', '-c', `(sleep 2.5; printf '${process.env.SHOT_KEYS ?? ''}'; sleep 0.5; printf 'q') | TERM=xterm-256color COLORTERM=truecolor script -q /dev/null bash -c "${inner}" > '${out}' 2>&1`])
if (r.exitCode !== 0) throw new Error('the window did not run')
const raw = readFileSync(out, 'utf8')
rmSync(dir, { recursive: true, force: true })
const frame = raw.split('\x1b[H').filter(f => f.length > COLS * 4).pop() ?? ''

// ---------- terminal output → cells ----------

type Cell = { ch: string; fg: string; bg: string; bold: boolean }
const grid: Cell[][] = Array.from({ length: ROWS }, () => [])
let row = 0
let fg = '#e6e8eb'
let bg = '#0d0f12'
let bold = false
const hex = (r: string, g: string, b: string) => `#${[r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('')}`
for (let i = 0; i < frame.length; i++) {
  const c = frame[i]!
  if (c === '\x1b') {
    const m = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(frame.slice(i))
    if (!m) continue
    i += m[0].length - 1
    if (m[2] !== 'm') continue
    const p = m[1]!.split(';')
    for (let k = 0; k < p.length; k++) {
      if (p[k] === '38' && p[k + 1] === '2') { fg = hex(p[k + 2]!, p[k + 3]!, p[k + 4]!); k += 4 }
      else if (p[k] === '48' && p[k + 1] === '2') { bg = hex(p[k + 2]!, p[k + 3]!, p[k + 4]!); k += 4 }
      else if (p[k] === '1') bold = true
      else if (p[k] === '22' || p[k] === '0') bold = false
    }
  } else if (c === '\n') row++
  else if (c !== '\r' && row < ROWS) grid[row]!.push({ ch: c, fg, bg, bold })
}

// ---------- cells → SVG, with numbered markers ----------

const CW = 8.2
const CH = 17
const PAD = 14
const LEFT = 30 // room for markers left of the first column
const W = Math.ceil(COLS * CW + PAD + LEFT)
const H = Math.ceil(ROWS * CH + PAD * 2)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const parts: string[] = []
const pageBg = grid[3]?.[COLS - 1]?.bg ?? '#0d0f12'
parts.push(`<rect width="${W}" height="${H}" rx="10" fill="${pageBg}"/>`)
grid.forEach((cells, y) => {
  let x = 0
  while (x < cells.length) {
    const start = x
    const c0 = cells[x]!
    while (x < cells.length && cells[x]!.bg === c0.bg) x++
    if (c0.bg !== pageBg) parts.push(`<rect x="${(LEFT + start * CW).toFixed(1)}" y="${PAD + y * CH}" width="${((x - start) * CW).toFixed(1)}" height="${CH}" fill="${c0.bg}"/>`)
  }
  x = 0
  while (x < cells.length) {
    const start = x
    const c0 = cells[x]!
    let text = ''
    while (x < cells.length && cells[x]!.fg === c0.fg && cells[x]!.bold === c0.bold) text += cells[x++]!.ch
    if (text.trim()) parts.push(`<text x="${(LEFT + start * CW).toFixed(1)}" y="${PAD + y * CH + 12.5}" fill="${c0.fg}"${c0.bold ? ' font-weight="700"' : ''} xml:space="preserve">${esc(text)}</text>`)
  }
})

// Markers sit just left of each area's label, found in the frame itself.
const lines = grid.map(cells => cells.map(c => c.ch).join(''))
if (process.env.SHOT_TEXT) writeFileSync(process.env.SHOT_TEXT, lines.join('\n'))
// [label, number, take the last match on its line (the details column repeats the selected id)]
const markers: [string, string, boolean?][] = [
  ['Principia - Your Claude Code Dashboard', '1'], ['SESSIONS', '2'], ['REQUIREMENTS', '3'], ['Conflict', '4'], ['1 Activity', '5'],
  ['SIGNALS', '6'], ['R1 ', '7', true], ['COMPLETION AUDIT', '8'], ['tab column', '9'],
]
for (const [label, n, last] of markers) {
  const y = last ? lines.findIndex(l => l.includes('SIGNALS')) : lines.findIndex(l => l.includes(label))
  if (y < 0) continue
  const x = last ? lines[y]!.lastIndexOf(label) : lines[y]!.indexOf(label)
  // In the gutter just before the label (columns are three cells apart).
  const cx = LEFT + Math.max(0, x) * CW - 13
  const cy = PAD + y * CH + CH / 2
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="#fbbf24" stroke="#0d0f12" stroke-width="2"/>`)
  parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" fill="#0d0f12" font-weight="700" text-anchor="middle" font-size="12">${n}</text>`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13.5">
<title>Principia - Your Claude Code Dashboard</title>
${parts.join('\n')}
</svg>
`
mkdirSync('docs', { recursive: true })
writeFileSync('docs/dashboard.svg', svg)
console.log(`docs/dashboard.svg · ${W}×${H} · ${markers.filter(([l]) => lines.some(x => x.includes(l))).length}/${markers.length} markers placed`)
