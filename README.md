# Praetorium

**Your Claude Code dashboard: every instruction in view while the agent works.**

In a long Claude Code session, what you asked for, what the agent plans, what it is doing and what has actually been checked all end up in one scrolling chat. Your corrections get buried, and you end up asking "did you do everything I asked?"

Praetorium keeps those apart:

- **Requirements ledger.** Each prompt you send is split into separate requirements (R1, R2…) by Claude Haiku, with your exact words kept. A later correction is linked to the requirement it changes; nothing is silently overwritten. You don't label anything.
- **Activity stream.** Edits, commands, tests, plans and the agent's messages. Reply to any one of them as a **comment** (the agent never sees it), a **new or refined requirement**, or an **instruction** to the agent, optionally interrupting it first. Each reply shows whether the agent actually received it.
- **Completion audit.** A requirement counts as verified only with evidence: a passing test, build or check run after the last edit, or your own acceptance. The agent saying it's done doesn't count.
- **Signals.** Tool calls that failed or were refused, and things the agent found that were new or unexpected, in one column so you don't have to dig through the chat.
- **Conflicts.** When a later message contradicts an earlier requirement, or the agent's work goes against one, the requirement is flagged until you resolve it, and the agent is told to ask you which wins.
- **Plan, Tests and Preview.** The agent's todo list with each step linked to the requirements it serves (and the ones it leaves out), every test or build run with the requirements it's evidence for, and the dev servers or preview links its commands printed.
- **Diffs where you read code.** A change opens in Cursor, VS Code or Windsurf, or as a diff in the terminal. No diffs are drawn in the ledger itself.

It shows up in two places: a **pane** inside each Claude Code session, and a **terminal window** that shows every session at once.

## Install

Open Claude Code and paste this. Claude does the rest.

> Install Praetorium: run **`claude plugin marketplace add aar2dee2/praetorium`** and then **`claude plugin install praetorium@praetorium`**. Then tell me to start a new Claude Code session, where Praetorium will ask whether it may read my existing transcripts to show earlier sessions; then run `/ledger window` to open the dashboard in my terminal, and ask whether I want to match my brand's colours with `/ledger theme import <my website or tailwind.config.js>`.

Works in the Claude Code terminal app and in the Claude desktop app's Code tab, on macOS, Windows and Linux.

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with plugin hooks, and [Git](https://git-scm.com/) for diffs. No Node, no Python.

The plugin runs inside Claude Code. The terminal window and the transcript importer are one standalone program, `praetorium` (built with Bun for macOS, Windows and Linux; 60–115 MB). The first `/ledger window` tells you this and asks you to run `/ledger install`.

### Update

> Update Praetorium: run `claude plugin marketplace update praetorium` and then `claude plugin update praetorium@praetorium`.

Then start a new session and run `/ledger install` once more: each version of the plugin uses its own build of the program. An open window switches to the new build by itself, and the old one is removed.

### Uninstall

> Uninstall Praetorium: run `claude plugin uninstall praetorium@praetorium` and `claude plugin marketplace remove praetorium`.

Your ledgers stay in `~/.claude/praetorium` until you delete that folder.

## Commands

Type these in any Claude Code session where Praetorium is installed.

### `/ledger`

Opens the Praetorium pane beside the conversation, with tabs for Requirements, Signals, Activity, Plan, Tests, Preview and Audit. It opens on its own when a session starts; use this to bring it back after closing it.

### `/ledger wide` · `/ledger narrow`

Asks for a wide pane (requirements, signals, activity and audit side by side) or a narrow one (tabs). Remembered across sessions. Dragging the pane's edge works too, and wins.

### `/ledger window`

Opens the dashboard in its own terminal window, showing **every** Claude Code session running Praetorium, not just this one. There's only ever one window: if it's already open, this switches it to the session you ran the command from. The first time, it asks you to run `/ledger install`.

### `/ledger window <terminal>`

The same, in a terminal you choose, remembered from then on. Without a name, the first installed one is used:

| macOS | Windows | Linux |
|---|---|---|
| `iterm`, `ghostty`, `wezterm`, `kitty`, `warp`, `terminal` | `wt` (Windows Terminal), `wezterm`, `pwsh`, `powershell`, `cmd` | `ghostty`, `wezterm`, `kitty`, `alacritty`, `gnome-terminal`, `konsole`, `x-terminal-emulator` |

### `/ledger install`

Downloads the `praetorium` program for your system from this repository's GitHub releases, checks it against the SHA-256 recorded in the plugin (a mismatch is deleted, never run), checks that it starts, and keeps it in `~/.claude/praetorium/bin`. Needed once per Praetorium version, for `/ledger window` and `/ledger import`.

### `/ledger import [days]`

Adds sessions you started **before** installing Praetorium, read from their Claude Code transcripts: the last 2 days by default, up to 30. Each appears in the window (marked ◌, read-only) with its requirements and activity. Needs your permission first (below). Costs one Haiku call per session imported.

### `/ledger import allow` · `/ledger import revoke`

Gives or withdraws permission to read transcripts. The first session after installing asks in a dialog; these change the answer later.

### `/ledger theme`

Shows the current theme and the presets.

### `/ledger theme <preset>`

Switches to `graphite` (the default), `paper` or `telborg`.

### `/ledger theme import <website | tailwind.config.js | file.css | theme.json>`

Builds a theme from your brand (see [Your own colours](#your-own-colours)).

## The terminal window

Titled **Praetorium - Your Claude Code Dashboard**. Sessions are listed by project with the names Claude Code gives them; ● working, ○ idle, ◌ imported, · not running. Only running sessions accept replies: one that has stopped says so instead of taking a message nobody would read.

| Key | Does |
|---|---|
| Tab · ←/→ | Move between columns |
| ↑/↓ | Move the selection |
| `[` · `]` | Previous / next session |
| `S` | Show or hide the Sessions column, for more room on one session |
| `1`–`5` | Activity, Plan, Tests, Preview, Signals |
| `/` · `F` | Search requirements · cycle the filter (open, done but not verified, verified, conflicts, yours, the agent's) |
| `c` or Enter | Comment on the selected event (the agent doesn't see it) · on a signal, go to its event · on a preview, open it |
| `n` | New requirement · on a signal, make the signal one |
| `f` | Refine the selected requirement |
| `i` | Instruction to the agent · Ctrl-T while typing interrupts it first |
| `x` | Resolve a requirement's conflict · dismiss a signal |
| `o` · `t` | Open the change's diff in your editor · in the terminal |
| `a` · `d` | Accept a requirement as verified · defer it |
| `g` | Ask the agent to close every open gap |
| `v` | All events, or key events only |
| `l` · `h` | Light or dark · show headless (`claude -p`) sessions |
| `q` | Quit |

Colours are full 24-bit where the terminal supports it, and the nearest of 256 elsewhere (Apple Terminal, older consoles).

## Sessions from before Praetorium

Sessions started before you installed Praetorium don't run it, so nothing in them can reach the agent. Their transcripts can still be read, with your permission:

- **Asked first.** The first session after installing shows a dialog explaining what would be read. Nothing is read until you choose Allow, including the session titles the window shows (until then it shows each session's first prompt). Change the answer with `/ledger import allow` or `revoke`.
- **What is read.** From `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`): your prompts, the agent's replies, and the name and file path or command of each tool call. File contents and diffs are not kept. Nothing is written to the transcripts.
- **When.** Once you allow it, sessions from the last 2 days are imported then, and each new session start imports any recent ones still missing (at most every 10 minutes).
- **What it costs.** One Claude Haiku call per session imported.
- **Reopen to connect.** When you reopen an old session, Praetorium loads in it and takes over its imported ledger. From there, replies, instructions and interrupts work as usual.

## Your own colours

A theme is eleven colours per mode: `bg`, `surface`, `surface2`, `border`, `text`, `text2`, `text3`, and four for status: `done` (verified), `active` (in progress), `warn` (needs review), `danger` (failed or blocked).

```text
/ledger theme import https://yourcompany.com
/ledger theme import ./tailwind.config.js
/ledger theme import ./src/app.css
/ledger theme import ./my-theme.json
```

- **A website**: its `theme-color`, inline styles and up to four stylesheets are read.
- **A Tailwind config or a CSS file** (Tailwind v3 `colors`, v4 `@theme`, CSS variables): only the lines carrying colours are read.
- **Any of those** goes to Claude Haiku, which maps your brand onto the eleven colours for both modes.
- **A theme JSON** in Praetorium's own format is used as is, with no model call:

```json
{
  "name": "acme",
  "dark":  { "bg": "#0b0b0f", "text": "#ececf1", "done": "#22c55e", "active": "#06b6d4" },
  "light": { "bg": "#ffffff", "text": "#111111", "done": "#15803d", "active": "#0e7490" }
}
```

Missing colours come from the default theme, and any colour too faint to read on its background (below WCAG contrast) is replaced, so an import can't make the dashboard unreadable.

## Cost and footprint

- **Per prompt:** one short Claude Haiku call to tag requirements. It also reads the agent's previous reply (up to 1,500 characters), because a message like "can we not get X?" only reads one way in context. Headless (`claude -p`) sessions aren't tagged.
- **Per agent turn** with a long reply: one more Haiku call, to pick out findings worth acting on and check the work against your requirements.
- **Per request:** about 225 tokens of tool definition, for the `ledger` tool the agent uses to report progress and evidence.
- **Imports and theme imports:** one Haiku call each.
- **Files:** none in your projects. Everything lives in `~/.claude/praetorium`: one small ledger per session (dropped after 30 days unused), pre-edit copies for diffs in `snapshots/` (dropped after 7 days; files that may hold secrets, like `.env` or keys, are never copied), and the program in `bin/` (older versions removed).

## Your secrets

Praetorium never reads env files or other files that may hold secrets: `.env` and every `.env.*`, `.npmrc`, `.netrc`, `.pgpass`, SSH keys (`id_rsa`, `id_ed25519`, `id_ecdsa`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials*` and `secret(s).*`. It doesn't copy them for diffs, doesn't open their diffs (in the pane, the window or the program), and won't import a theme from one. When the agent edits such a file, the activity shows that it did, never what's inside.

It does read a few environment *variables*, only to find its folders and the right terminal: `HOME` / `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `TMPDIR` / `TEMP` / `TMP`, `SHELL`, `OS`, `CLAUDE_CODE_ENTRYPOINT`, and in the window `TERM`, `TERM_PROGRAM`, `COLORTERM`, `WT_SESSION`, `KITTY_WINDOW_ID`. Nothing else, and none are stored or sent anywhere.

## How it works

Praetorium is a Claude Code plugin made of function hooks (`hooks/register.tsx`):

- `prompt.submit` tags requirements with Haiku, flags conflicts, and tells the agent the ids.
- `tool.call` turns edits, commands, tests and plans into activity, records failed or refused calls as signals, and copies a file before it is edited (for diffs). It never fails your tool call, even if Praetorium itself errors.
- `turn.start` / `turn.complete` track whether the agent is working, record its answers, and run the per-turn review.
- The `ledger` tool lets the agent report progress; `verified` is refused without a passing test, build or check after the last edit.
- Replies reach the agent inside its running turn, start a new turn, or wait for your next prompt, and say which happened.
- `viewer/` is the `praetorium` program (`cli.mjs`): the terminal window (`ledger-view.mjs`), which reads each session's ledger and writes your actions to an inbox the session polls; the transcript importer (`import.mjs`); and the diff view. `scripts/build.ts` compiles it per platform and records the checksums in `hooks/release.ts`.
- `hooks/tagging.ts` holds the Haiku prompts; `hooks/work.ts` links plan steps, finds preview links and filters requirements, shared by the pane and the window.

## Develop

```bash
git clone https://github.com/aar2dee2/praetorium.git
```

Run Claude Code from your clone instead of the marketplace build by adding this to the `env` block of `~/.claude/settings.json`, then start a new session. Edits reload live, and with [Bun](https://bun.sh) installed the window runs from source. Don't also install it from the marketplace, or it loads twice; remove these lines before going back to the installed version.

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

Live checks against the real model and your machine (Claude Code signed in):

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

### Releasing

Bump the version in `.claude-plugin/plugin.json`, run `bun scripts/build.ts` (it rewrites `hooks/release.ts` with the new checksums), commit, tag `v<version>` on that commit, and publish `dist/praetorium-*` as that tag's release.

## License

MIT
