# Praetorium

A Claude Code mod that keeps what you asked for separate from what the agent is doing.

- **Requirements ledger**: Haiku tags each prompt into atomic requirements (R1, R2…), keeping your exact words; refinements link to the original.
- **Activity stream**: edits, commands, tests, plans and agent messages, each with a stable id you can reply to: as a comment, a new or refined requirement, or an instruction (optionally interrupting the agent).
- **Completion audit**: "verified" needs a passing check after the last edit, or your acceptance. The agent saying it's done doesn't count.
- **Views**: a pane in the session (`/ledger`, `/ledger wide`) and a terminal window across every session (`/ledger window`, iTerm or Terminal).
- **Colours**: Telborg brand tokens (`telborg_news/design.md`).

## Install

Add to the `env` block of `~/.claude/settings.json`, then start a new session:

```json
"CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/praetorium",
"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
```

## Files

- `hooks/register.tsx`: the mod
- `types/index.d.ts`: its session state contract
- `viewer/ledger-view.mjs`: the terminal window (Node, no dependencies)
- `tests/`: `claude plugin test .`

Runtime files: `/tmp/claude-ledger/` (per-session state mirror, reply inbox, pre-edit snapshots for diffs).
