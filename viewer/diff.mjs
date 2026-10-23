// A change's diff in the terminal: through less where it exists, else printed with a key to close.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'

function gitDiff(snap, file) {
  const args = snap
    ? ['--no-pager', 'diff', '--no-index', '--color=always', '--', snap, file]
    : ['--no-pager', '-C', path.dirname(file), 'diff', '--color=always', '--', file]
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.error) return 'git was not found, so the diff cannot be shown.\n'
  return r.stdout || 'No changes.\n'
}

export function showDiff(snap, file) {
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
