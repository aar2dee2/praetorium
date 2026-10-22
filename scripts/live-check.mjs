// Live checks against the real model and the real machine, for what unit tests can't cover.
// Uses the mod's own prompts and parsers, so it checks what the mod sends.
//
//   node scripts/live-check.mjs tagging
//   node scripts/live-check.mjs theme <website URL | tailwind.config.js | file.css>
//   node scripts/live-check.mjs terminal <terminal id>
//
// Model calls go through `claude -p` with plugins kept out, so Claude Code must be signed in.
// Needs Node 22.18+ or 23.6+ (it imports the mod's TypeScript files directly).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { TAG_SYSTEM, parseTagged, tagPrompt } from '../hooks/tagging.ts'
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
  // Project settings only and no plugin folders, so Praetorium itself doesn't tag the check's prompt.
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
  const marker = path.join(os.tmpdir(), `praetorium-check-${Date.now()}`)
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`]
  const launch = launchCommand(osName, term, argv, 'Praetorium check', os.homedir())
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

const checks = { tagging, theme, terminal }
if (!checks[check] || (check !== 'tagging' && !arg)) {
  console.error('usage: live-check.mjs tagging | theme <source> | terminal <id>')
  process.exit(2)
}
await checks[check](arg)
process.exit(failed ? 1 : 0)
