# Praetorium

**Keep every instruction in view while Claude Code works.**

In a long Claude Code session, what you asked for, what the agent plans, what it is doing and what has actually been checked all end up in one scrolling chat. Your corrections get buried, and you end up asking "did you do everything I asked?"

Praetorium keeps those apart:

- **Requirements ledger.** Each prompt you send is split into separate requirements (R1, R2…) by Claude Haiku, with your exact words kept. A later correction is linked to the requirement it changes; nothing is silently overwritten. You don't label anything.
- **Activity stream.** Edits, commands, tests, plans and the agent's messages, each with a stable id. Reply to any one of them as a **comment** (the agent never sees it), a **new or refined requirement**, or an **instruction** to the agent, optionally interrupting it first. Each reply shows whether the agent has received it.
- **Completion audit.** A requirement counts as verified only with evidence: a passing test or build run after the last edit, or your own acceptance. The agent saying it's done doesn't count.
- **Signals.** Tool calls that failed or were refused, and things the agent found that were new or unexpected, collected in one column so you don't have to dig through the chat. Reply to one, make it a requirement, or dismiss it.
- **Conflicts.** When a later message contradicts an earlier requirement, or the agent's work goes against one, the requirement is flagged until you resolve it, and the agent is told to ask you which wins.
- **Plan, Tests and Preview.** The agent's todo list with each step linked to the requirements it serves (and the requirements it leaves out), every test or build run with the requirements it's evidence for, and local dev servers or preview links its commands printed.
- **Search and filters** for requirements: open, done but not verified, verified, conflicts, yours or the agent's.
- **Diffs where you read code.** Opens a change in Cursor, VS Code or Windsurf, or as a diff in the terminal. No diffs are drawn in the ledger itself.

It shows up in two places: a pane inside the session, and a window in your own terminal that lists every Claude Code session running Praetorium.

## Install

Open Claude Code and paste this. Claude does the rest.

> Install Praetorium: run **`claude plugin marketplace add aar2dee2/praetorium`** and then **`claude plugin install praetorium@praetorium`**. Then tell me to start a new Claude Code session, where Praetorium will ask whether it may read my existing transcripts to show earlier sessions; then run `/ledger window` to open the ledger in my terminal, and ask whether I want to match my brand's colours with `/ledger theme import <my website or tailwind.config.js>`.

It works in the Claude Code terminal app and in the Claude desktop app's Code tab, on macOS, Windows and Linux.

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with plugin hooks. For diffs: [Git](https://git-scm.com/). Nothing else: no Node, no Python.

The plugin runs inside Claude Code. The terminal window and the transcript importer are one small standalone program (`praetorium`, built with Bun for macOS, Windows and Linux). The first time you run `/ledger window`, Praetorium tells you its size and asks you to run `/ledger install`, which downloads it from this repository's releases, checks it against the SHA-256 recorded in the plugin, and keeps it in `~/.claude/praetorium/bin`.

### Update

> Update Praetorium: run `claude plugin marketplace update praetorium` and then `claude plugin update praetorium@praetorium`.

### Uninstall

> Uninstall Praetorium: run `claude plugin uninstall praetorium@praetorium` and `claude plugin marketplace remove praetorium`.

## Use

| Command | Does |
|---|---|
| `/ledger` | Open the pane in this session |
| `/ledger wide` · `/ledger narrow` | Ask for a wide pane (three columns side by side) or a narrow one (tabs) |
| `/ledger window` | Open the ledger in a terminal window, across all your sessions. If it's already open, it switches to this session instead |
| `/ledger window <terminal>` | Open it in a specific terminal, and remember the choice |
| `/ledger install` | Download the window's program (once, checksum-verified) |
| `/ledger theme` | Show the current theme and the presets |
| `/ledger theme <preset>` | `graphite` (default), `paper`, `telborg` |
| `/ledger theme import <source>` | Build a theme from your brand (below) |
| `/ledger import [days]` | Show sessions started before Praetorium, from their transcripts (default 2 days, up to 30) |
| `/ledger import allow` · `revoke` | Allow or stop reading transcripts |

### Terminals

`/ledger window` uses the first one it finds, or the one you name:

| macOS | Windows | Linux |
|---|---|---|
| `iterm`, `ghostty`, `wezterm`, `kitty`, `warp`, `terminal` | `wt` (Windows Terminal), `wezterm`, `pwsh`, `powershell`, `cmd` | `ghostty`, `wezterm`, `kitty`, `alacritty`, `gnome-terminal`, `konsole`, `x-terminal-emulator` |

Colours are full 24-bit where the terminal supports it, and the nearest of 256 elsewhere (Apple Terminal, older consoles).

There's one window for all sessions. It picks up new and imported sessions as they appear, and restarts itself when Praetorium updates, keeping your place.

### Keys in the terminal window

| Key | Does |
|---|---|
| Tab · ←/→ | Move between columns |
| ↑/↓ | Move the selection |
| `[` · `]` | Previous / next session |
| `S` | Show or hide the Sessions column, for more room on one session |
| `1`–`5` | Activity, Plan, Tests, Preview, Signals |
| `/` · `F` | Search requirements · cycle the filter |
| `c` or Enter | Comment on the selected event (the agent doesn't see it) |
| `n` | New requirement (on a signal: make the signal one) |
| `f` | Refine the selected requirement |
| `i` | Instruction to the agent · Ctrl-T while typing interrupts it first |
| `x` | Resolve a requirement's conflict · dismiss a signal |
| `o` · `t` | Open the change's diff in your editor · in the terminal |
| `a` · `d` | Accept a requirement as verified · defer it |
| `g` | Ask the agent to close every open gap |
| `v` | All events, or key events only |
| `l` · `h` | Light or dark · show headless (`claude -p`) sessions |
| `q` | Quit |

Sessions are named as Claude Code names them and grouped by project. Only running sessions accept replies; one that has stopped says so instead of taking a message nobody will read.

## Sessions from before Praetorium

Sessions started before you installed Praetorium don't run it, so nothing in them can reach the agent. Their transcripts can still be read:

- **Asked first.** The first session after installing shows a dialog explaining what would be read. Nothing is read until you choose Allow. The answer is remembered; change it with `/ledger import allow` or `/ledger import revoke`.
- **What is read.** From `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`), for sessions active in the last 2 days by default: your prompts, the agent's replies, and the name and file path or command of each tool call. File contents and diffs are not kept. Nothing is written to the transcripts.
- **What it costs.** One Claude Haiku call per session, to list its requirements.
- **What you get.** Each session appears in `/ledger window` (marked ◌, read-only), with its requirements and activity. Imported requirements start as not started: there's no evidence about them yet.
- **Reopen to connect.** When you reopen an old session, Praetorium loads in it and takes over its imported ledger (or reads its transcript then, if you allowed it). From there, replies, instructions and interrupts work as usual.

## Your own colours

A theme is eleven colours per mode: `bg`, `surface`, `surface2`, `border`, `text`, `text2`, `text3`, and four for status: `done` (verified), `active` (in progress), `warn` (needs review), `danger` (failed or blocked). Light and dark are both set.

Import one from what you already have:

```text
/ledger theme import https://yourcompany.com
/ledger theme import ./tailwind.config.js
/ledger theme import ./src/app.css
/ledger theme import ./my-theme.json
```

- **A website**: Praetorium reads its `theme-color`, inline styles and up to four stylesheets.
- **A Tailwind config or a CSS file** (Tailwind v3 `colors`, v4 `@theme`, CSS variables): only the lines carrying colours are read.
- **Any of those** goes to Claude Haiku, which maps your brand onto the eleven colours for both modes, deriving the one your source doesn't define.
- **A theme JSON** in Praetorium's own format is used as is, with no model call:

```json
{
  "name": "acme",
  "dark":  { "bg": "#0b0b0f", "text": "#ececf1", "done": "#22c55e", "active": "#06b6d4" },
  "light": { "bg": "#ffffff", "text": "#111111", "done": "#15803d", "active": "#0e7490" }
}
```

Missing colours come from the default theme, and any colour too faint to read on its background (below WCAG contrast) is replaced, so an import can't make the ledger unreadable.

## Cost and footprint

- One short Claude Haiku call per prompt you send, to tag requirements. It also reads the agent's previous reply (up to 1,500 characters), because a message like "can we not get X?" only reads one way in context. Theme imports make one more call.
- About 225 tokens of tool definition on each request, for the `ledger` tool the agent uses to report progress and evidence.
- One more Haiku call per agent turn with a long reply, to pick out findings worth acting on and check the work against your requirements.
- No database and no files in your projects. Each session's ledger lives in Claude Code's session state, with a copy in `~/.claude/praetorium/` (one small file per session, dropped after 30 days unused) that the terminal window reads. Pre-edit copies used for diffs go to your system temp folder.

## How it works

Praetorium is a Claude Code plugin made of function hooks (`hooks/register.tsx`):

- `prompt.submit` tags requirements with Haiku and tells the agent their ids.
- `tool.call` turns edits, commands, tests and plans into activity events, and saves a copy of each file before it is edited.
- `turn.start` / `turn.complete` track whether the agent is working and record its answers.
- The `ledger` tool lets the agent mark progress; `verified` is refused without a passing check after the last edit.
- Replies reach the agent inside its running turn, start a new turn, or wait for your next prompt; an interrupt cancels the turn first.
- `viewer/` is the `praetorium` program (`cli.mjs`): the terminal window (`ledger-view.mjs`), which reads the state files and writes your actions to an inbox the session polls; the transcript importer (`import.mjs`); and the diff view. `scripts/build.ts` compiles it per platform and records the checksums in `hooks/release.ts`.
- `hooks/tagging.ts` holds the prompts that turn messages into requirements and review each turn; `hooks/work.ts` links plan steps, finds preview links and filters requirements, shared by the pane and the window.

## Develop

```bash
git clone https://github.com/aar2dee2/praetorium.git
```

Point Claude Code at your clone instead of installing it, by adding this to the `env` block of `~/.claude/settings.json`, then start a new session. Edits reload live.

```json
"CLAUDE_CODE_PLUGIN_DIRS": "/path/to/praetorium",
"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
bun scripts/build.ts
```

With [Bun](https://bun.sh) installed, Praetorium runs the window from source instead of a downloaded build. Live checks against the real model and your machine (Claude Code signed in):

```bash
bun scripts/live-check.mjs tagging
```

```bash
bun scripts/live-check.mjs theme https://yourcompany.com
```

```bash
bun scripts/live-check.mjs terminal iterm
```

```bash
bun scripts/live-check.mjs import <session id>
```

## License

MIT
