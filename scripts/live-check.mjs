// Live checks against the real model and the real machine, for what unit tests can't cover.
// Uses the mod's own prompts and parsers, so it checks what the mod sends.
//
//   node scripts/live-check.mjs tagging
//   node scripts/live-check.mjs theme <website URL | tailwind.config.js | file.css>
//   node scripts/live-check.mjs terminal <terminal id>
//   node scripts/live-check.mjs import <session id>   (reads that one transcript)
//
// Model calls go through `claude -p` with plugins kept out, so Claude Code must be signed in.
// Needs Node 22.18+ or 23.6+ (it imports the mod's TypeScript files directly).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { TAG_SYSTEM, buildLedger, parseTagged, tagPrompt } from '../hooks/tagging.ts'
import { IMPORT_SYSTEM, colourLines, contrast, pageParts, sourceKind, themeFromReply } from '../hooks/theme.ts'
import { LINUX, MAC, WINDOWS, launchCommand } from '../hooks/platform.ts'

const HAIKU = 'claude-haiku-5-5'
const [check, arg] = process.argv.slice(2)
let failed = 0

function result(ok, label, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`)
}

function haiku(system, prompt) {
  // Project settings only and no plugin folders, so Principia itself doesn't tag the check's prompt.
  const args = ['-p', '--model', HAIKU, '--system-prompt', system, '--tools', '', '--no-session-persistence', '--setting-sources', 'project']
  const r = spawnSync('claude', args, {
    input: prompt, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000,
    env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' },
  })
  if (r.status !== 0) throw new Error(`claude -p failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
  return r.stdout
}

async function tagging() {
  // [message, check on the titles, label, existing requirements?, the agent's previous reply?]
  const cases = [
    ['How do I make it possible to see all my Claude Code sessions in this?', t => t.length >= 1 && /session/i.test(t.join(' ')), 'a request phrased as a question is tagged'],
    ['Can we not get it as a separate window, like a terminal window or something else that just uses the native terminal in my system?',
      t => t.length >= 1 && t.every(x => /window|terminal/i.test(x) && !/\b(avoid|not|don't|no|instead of)\b/i.test(x)),
      '"can we not get X", after the agent said X isn\'t possible, asks for X',
      [{ id: 'R1', title: 'Add a full-window view of the ledger' }],
      'The mod API has no "full window" option; a pane can only ask for a wider dock. I added /ledger wide and a side-by-side layout when the pane is wide.'],
    ['Show title, source and date, and highlight matched keywords.', t => t.length >= 2, 'two asks in one sentence become two'],
    ['yes, go ahead', t => t.length === 0, 'an approval is not a requirement'],
    ['What does the ledger tool cost in tokens?', t => t.length === 0, 'a question asking only for information is skipped'],
    ['Please preserve the existing tag colours. Reuse the current classes rather than introducing new ones.', t => t.length >= 1 && /colou?r|class/i.test(t.join(' ')), 'a correction is tagged'],
  ]
  // Refinement and conflict links, judged on the items rather than the titles.
  const existing = [{ id: 'R5', title: 'Use Telborg brand colours from the telborg_news repo' }, { id: 'R12', title: 'Install by pasting a few lines, like the gstack installer' },
    { id: 'R15', title: 'Support Windows and Mac terminal apps' }, { id: 'R25', title: 'Add search and filters for requirements' },
    { id: 'R44', title: 'Run periodic audits of the repo from cloud sessions' }, { id: 'R2', title: 'Keep the existing tag colours' }]
  const links = [
    ['the interface goes between light and dark mode as I toggle sessions', items => items.length >= 1 && items.every(i => !i.refines), 'a new ask about the same screen is not a refinement of R5'],
    ['can we have a setup without node - users might not have node installed', items => items.length >= 1 && items.every(i => !i.refines), 'a new ask is not a refinement of R12 or R15'],
    // Refinement and conflict sit close together; either keeps the link (a conflict just asks the user which wins).
    ['use the lime from the telborg site for verified, not the darker olive', items => items.some(i => i.refines === 'R5' || i.conflicts === 'R5'), 'a correction stays linked to R5'],
    // A deliberate "actually…" may read as a refinement (the newer wording wins) or a conflict; either way it must stay linked to R25.
    ['actually, drop the search box from the requirements list, filters are enough', items => items.some(i => i.conflicts === 'R25' || i.refines === 'R25'), 'a reversal stays linked to R25, never a silent new item'],
    ['give every tag a fresh colour from the new palette', items => items.some(i => i.conflicts === 'R2'), 'an unacknowledged clash with R2 is flagged as a conflict'],
    ['twice a week is okay for now. if we get a lot of activity from contributors we can increase the frequency', items => items.some(i => i.refines === 'R44' && i.revisit), '"okay for now, increase later if…" marks R44 to revisit'],
  ]
  for (const [message, ok, label] of links) {
    const items = parseTagged(haiku(TAG_SYSTEM, tagPrompt(existing, message)))
    result(ok(items), label, items.map(i => `${i.title}${i.refines ? ` (refines ${i.refines})` : ''}${i.conflicts ? ` (conflicts ${i.conflicts})` : ''}${i.revisit ? ` (revisit ${i.revisit})` : ''}`).join(' | ') || '(none)')
  }
  for (const [message, ok, label, existing = [], lastReply = ''] of cases) {
    const titles = parseTagged(haiku(TAG_SYSTEM, tagPrompt(existing, message, lastReply))).map(i => i.title)
    result(ok(titles), label, `${titles.length} tagged: ${titles.join(' | ') || '(none)'}`)
  }
}

async function readSource(from) {
  if (!/^https?:\/\//i.test(from)) return colourLines(fs.readFileSync(from, 'utf8'))
  const page = await fetch(from)
  if (!page.ok) throw new Error(`${from} answered ${page.status}`)
  const { inline, stylesheets } = pageParts(await page.text(), from)
  const sheets = []
  for (const href of stylesheets) {
    const res = await fetch(href).catch(() => undefined)
    if (res?.ok) sheets.push(await res.text())
  }
  return colourLines([...inline, ...sheets].join('\n'))
}

async function theme(from) {
  const text = await readSource(from)
  result(text.trim().length > 0, `colours found in ${sourceKind(from)}`, `${text.split('\n').length} colour lines`)
  const t = themeFromReply(haiku(IMPORT_SYSTEM, `Source: ${sourceKind(from)}\n\n${text}`))
  const sourceHex = new Set((text.match(/#[0-9a-f]{6}\b/gi) ?? []).map(h => h.toLowerCase()))
  const used = [...new Set([...Object.values(t.dark), ...Object.values(t.light)])].filter(h => sourceHex.has(h))
  result(used.length > 0, 'the theme uses the brand\'s own colours', `name "${t.name}", brand colours used: ${used.join(' ') || 'none'}`)
  for (const mode of ['dark', 'light']) {
    result(contrast(t[mode].text, t[mode].bg) >= 4.5, `${mode} text is readable`, `contrast ${contrast(t[mode].text, t[mode].bg).toFixed(1)}:1`)
  }
  console.log(JSON.stringify(t, null, 2))
}

async function terminal(id) {
  const osName = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
  const list = osName === 'mac' ? MAC : osName === 'windows' ? WINDOWS : LINUX
  const term = list.find(t => t.id === id)
  if (!term) return result(false, `${id} is a supported terminal on ${osName}`, `supported: ${list.map(t => t.id).join(', ')}`)
  const marker = path.join(os.tmpdir(), `principia-check-${Date.now()}`)
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`]
  const launch = launchCommand(osName, term, argv, 'Principia check', os.homedir())
  if (launch.file) {
    fs.mkdirSync(path.dirname(launch.file.path), { recursive: true })
    fs.writeFileSync(launch.file.path, launch.file.text)
  }
  const r = spawnSync(launch.cmd[0], launch.cmd.slice(1), { encoding: 'utf8' })
  result(r.status === 0, `${term.name} accepted the launch command`, (r.stderr || '').trim())
  for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await new Promise(res => setTimeout(res, 250))
  result(fs.existsSync(marker), `${term.name} ran a command in a new window`)
  fs.rmSync(marker, { force: true })
}

async function importOne(id) {
  const out = path.join(os.tmpdir(), `principia-import-check-${Date.now()}.json`)
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const r = spawnSync(process.execPath, [new URL('../viewer/import.mjs', import.meta.url).pathname, path.join(config, 'projects'), out, '--session', id], { encoding: 'utf8' })
  result(r.status === 0, 'the transcript was read', (r.stderr || r.stdout).trim())
  const [past] = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(out, { force: true })
  result(Boolean(past?.prompts.length), 'it has your prompts', past ? `${past.prompts.length} prompts, ${past.tools.length} tool calls, title "${past.title}"` : 'none')
  if (!past) return
  const leak = past.prompts.some(p => /<system-reminder>|<command-name>/.test(p.text))
  result(!leak, 'injected reminders and command wrappers are left out')
  const built = await buildLedger(past.prompts, past.replies, async (system, prompt) => haiku(system, prompt))
  result(!built.failed && built.items.length > 0, 'Haiku listed its requirements', built.failed ?? built.items.map(i => `${i.id} [${i.status}] ${i.title}`).join('\n      '))
}

const checks = { tagging, theme, terminal, import: importOne }
if (!checks[check] || (check !== 'tagging' && !arg)) {
  console.error('usage: live-check.mjs tagging | theme <source> | terminal <id>')
  process.exit(2)
}
await checks[check](arg)
process.exit(failed ? 1 : 0)
