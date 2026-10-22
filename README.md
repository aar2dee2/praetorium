# Praetorium

**Keep every instruction in view while Claude Code works.**

In a long Claude Code session, what you asked for, what the agent plans, what it is doing and what has actually been checked all end up in one scrolling chat. Your corrections get buried, and you end up asking "did you do everything I asked?"

Praetorium keeps those apart:

- **Requirements ledger.** Each prompt you send is split into separate requirements (R1, R2…) by Claude Haiku, with your exact words kept. A later correction is linked to the requirement it changes; nothing is silently overwritten. You don't label anything.
- **Activity stream.** Edits, commands, tests, plans and the agent's messages, each with a stable id. Reply to any one of them as a **comment** (the agent never sees it), a **new or refined requirement**, or an **instruction** to the agent, optionally interrupting it first. Each reply shows whether the agent has received it.
- **Completion audit.** A requirement counts as verified only with evidence: a passing test or build run after the last edit, or your own acceptance. The agent saying it's done doesn't count.
- **Diffs where you read code.** Opens a change in Cursor, VS Code or Windsurf, or as a diff in the terminal. No diffs are drawn in the ledger itself.

It shows up in two places: a pane inside the session, and a window in your own terminal that lists every Claude Code session running Praetorium.

## Install

Open Claude Code and paste this. Claude does the rest.

> Install Praetorium: run **`claude plugin marketplace add aar2dee2/praetorium`** and then **`claude plugin install praetorium@praetorium`**. Then tell me to start a new Claude Code session, run `/ledger window` to open the ledger in my terminal, and ask whether I want to match my brand's colours with `/ledger theme import <my website or tailwind.config.js>`.

It works in the Claude Code terminal app and in the Claude desktop app's Code tab, on macOS, Windows and Linux.

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with plugin hooks. For the terminal window: [Node.js](https://nodejs.org/) 18 or newer. For diffs: [Git](https://git-scm.com/).

### Update

> Update Praetorium: run `claude plugin marketplace update praetorium` and then `claude plugin update praetorium@praetorium`.

### Uninstall

> Uninstall Praetorium: run `claude plugin uninstall praetorium@praetorium` and `claude plugin marketplace remove praetorium`.

## Use

| Command | Does |
|---|---|
| `/ledger` | Open the pane in this session |
| `/ledger wide` · `/ledger narrow` | Ask for a wide pane (three columns side by side) or a narrow one (tabs) |
| `/ledger window` | Open the ledger in a terminal window, across all your sessions |
| `/ledger window <terminal>` | Open it in a specific terminal, and remember the choice |
| `/ledger theme` | Show the current theme and the presets |
| `/ledger theme <preset>` | `graphite` (default), `paper`, `telborg` |
| `/ledger theme import <source>` | Build a theme from your brand (below) |

### Terminals

`/ledger window` uses the first one it finds, or the one you name:

| macOS | Windows | Linux |
|---|---|---|
| `iterm`, `ghostty`, `wezterm`, `kitty`, `warp`, `terminal` | `wt` (Windows Terminal), `wezterm`, `pwsh`, `powershell`, `cmd` | `ghostty`, `wezterm`, `kitty`, `alacritty`, `gnome-terminal`, `konsole`, `x-terminal-emulator` |

Colours are full 24-bit where the terminal supports it, and the nearest of 256 elsewhere (Apple Terminal, older consoles).

### Keys in the terminal window

| Key | Does |
|---|---|
| Tab · ←/→ | Move between Sessions, Requirements and Activity |
| ↑/↓ | Move the selection |
| `[` · `]` | Previous / next session |
| `c` or Enter | Comment on the selected event (the agent doesn't see it) |
| `n` | New requirement |
| `f` | Refine the selected requirement |
| `i` | Instruction to the agent · Ctrl-T while typing interrupts it first |
| `o` · `t` | Open the change's diff in your editor · in the terminal |
| `a` · `d` | Accept a requirement as verified · defer it |
| `g` | Ask the agent to close every open gap |
| `v` | All events, or key events only |
| `l` | Light or dark |
| `q` | Quit |

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

- One short Claude Haiku call per prompt you send, to tag requirements. Theme imports make one more.
- About 150 tokens of tool description on each request, for the `ledger` tool the agent uses to report progress and evidence.
- No database and no files in your projects. Each session's ledger lives in Claude Code's session state, with a copy in the plugin's own store so it survives a restart. The terminal window reads a per-session file in your system temp folder (`praetorium/`), which also holds the pre-edit copies used for diffs.

## How it works

Praetorium is a Claude Code plugin made of function hooks (`hooks/register.tsx`):

- `prompt.submit` tags requirements with Haiku and tells the agent their ids.
- `tool.call` turns edits, commands, tests and plans into activity events, and saves a copy of each file before it is edited.
- `turn.start` / `turn.complete` track whether the agent is working and record its answers.
- The `ledger` tool lets the agent mark progress; `verified` is refused without a passing check after the last edit.
- Replies reach the agent inside its running turn, start a new turn, or wait for your next prompt; an interrupt cancels the turn first.
- `viewer/ledger-view.mjs` is the terminal window: plain Node, no dependencies. It reads the state files and writes your actions to an inbox file the session polls.

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

## License

MIT
