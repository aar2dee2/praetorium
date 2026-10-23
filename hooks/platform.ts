export type OS = 'mac' | 'windows' | 'linux'
export type Editor = { name: string; bin: string }

export type Platform = {
  os: OS
  // Disposable: pre-edit copies used for diffs.
  tmp: string
  // Kept: each session's ledger, the window's inbox and heartbeat, the downloaded program.
  data: string
  // How to run the praetorium program (window, importer, diff); empty until it's installed.
  runner: string[]
  editors: Editor[]
}

// The standalone program's file name for this machine, as published on each release.
export function programName(os: OS, arch: string): string {
  const a = /arm|aarch/i.test(arch) ? 'arm64' : 'x64'
  return os === 'windows' ? `praetorium-windows-${a}.exe` : `praetorium-${os === 'mac' ? 'darwin' : 'linux'}-${a}`
}

export const join = (...parts: string[]) => parts.join('/').replace(/[\\/]+/g, '/')
export const base = (p: string) => p.split(/[\\/]/).pop() ?? p

export const firstLine = (s?: string) => (s ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? ''

// name, command on PATH, macOS app bundle CLI
export const EDITORS: [string, string, string][] = [
  ['Cursor', 'cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
  ['VS Code', 'code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
  ['Windsurf', 'windsurf', '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'],
]

// ---------- terminal windows ----------

export type Terminal = { id: string; name: string }

export const MAC: (Terminal & { app: string })[] = [
  { id: 'iterm', name: 'iTerm', app: '/Applications/iTerm.app' },
  { id: 'ghostty', name: 'Ghostty', app: '/Applications/Ghostty.app' },
  { id: 'wezterm', name: 'WezTerm', app: '/Applications/WezTerm.app' },
  { id: 'kitty', name: 'kitty', app: '/Applications/kitty.app' },
  { id: 'warp', name: 'Warp', app: '/Applications/Warp.app' },
  { id: 'terminal', name: 'Terminal', app: '/System/Applications/Utilities/Terminal.app' },
]
export const WINDOWS: (Terminal & { cmd: string })[] = [
  { id: 'wt', name: 'Windows Terminal', cmd: 'wt' },
  { id: 'wezterm', name: 'WezTerm', cmd: 'wezterm' },
  { id: 'pwsh', name: 'PowerShell 7', cmd: 'pwsh' },
  { id: 'powershell', name: 'Windows PowerShell', cmd: 'powershell' },
  { id: 'cmd', name: 'Command Prompt', cmd: 'cmd' },
]
export const LINUX: (Terminal & { cmd: string })[] = [
  { id: 'ghostty', name: 'Ghostty', cmd: 'ghostty' },
  { id: 'wezterm', name: 'WezTerm', cmd: 'wezterm' },
  { id: 'kitty', name: 'kitty', cmd: 'kitty' },
  { id: 'alacritty', name: 'Alacritty', cmd: 'alacritty' },
  { id: 'gnome-terminal', name: 'GNOME Terminal', cmd: 'gnome-terminal' },
  { id: 'konsole', name: 'Konsole', cmd: 'konsole' },
  { id: 'x-terminal-emulator', name: 'default terminal', cmd: 'x-terminal-emulator' },
]

const sq = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`
const applescript = (x: string) => x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export type Launch = { cmd: string[]; file?: { path: string; text: string } }

// The command that opens `argv` in a new window of `term`.
export function launchCommand(os: OS, term: Terminal, argv: string[], title: string, home: string): Launch | undefined {
  const posix = argv.map(sq).join(' ')
  if (os === 'mac') {
    const app = MAC.find(t => t.id === term.id)?.app ?? ''
    switch (term.id) {
      case 'iterm':
        return { cmd: ['osascript', '-e', 'tell application "iTerm"', '-e', 'activate', '-e', 'set w to (create window with default profile)',
          '-e', `tell current session of w to write text "${applescript(`clear; exec ${posix}`)}"`, '-e', 'end tell'] }
      case 'terminal':
        return { cmd: ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script "${applescript(`clear; exec ${posix}`)}"`, '-e', 'end tell'] }
      case 'ghostty':
        return { cmd: ['open', '-na', app, '--args', `--title=${title}`, '-e', ...argv] }
      case 'wezterm':
        return { cmd: [`${app}/Contents/MacOS/wezterm`, 'start', '--always-new-process', '--', ...argv] }
      case 'kitty':
        return { cmd: [`${app}/Contents/MacOS/kitty`, '--title', title, ...argv] }
      case 'warp': {
        // Warp runs a command in a new window only through a launch configuration.
        const path = join(home, '.warp/launch_configurations/praetorium.yaml')
        const text = `---\nname: Praetorium\nwindows:\n  - tabs:\n      - title: ${title}\n        layout:\n          cwd: ${JSON.stringify(home)}\n          commands:\n            - exec: ${JSON.stringify(posix)}\n`
        return { cmd: ['open', `warp://launch/${encodeURIComponent(path)}`], file: { path, text } }
      }
      default:
        return undefined
    }
  }
  if (os === 'windows') {
    switch (term.id) {
      case 'wt': return { cmd: ['wt', '-w', 'new', '--title', title, ...argv] }
      case 'wezterm': return { cmd: ['wezterm', 'start', '--', ...argv] }
      // `start` takes the first quoted argument as the window title, so the title stays unquoted
      // and one word; the program then runs directly, with no inner shell to re-parse its arguments.
      case 'pwsh':
      case 'powershell': return { cmd: ['cmd', '/c', 'start', 'Praetorium', term.id, '-NoExit', '-Command', `& ${argv.map(a => `'${a.replace(/'/g, "''")}'`).join(' ')}`] }
      default: return { cmd: ['cmd', '/c', 'start', 'Praetorium', ...argv] }
    }
  }
  switch (term.id) {
    case 'gnome-terminal': return { cmd: ['gnome-terminal', '--title', title, '--', ...argv] }
    case 'wezterm': return { cmd: ['wezterm', 'start', '--', ...argv] }
    case 'kitty': return { cmd: ['kitty', '--title', title, ...argv] }
    default: return { cmd: [term.id, '-e', ...argv] }
  }
}
