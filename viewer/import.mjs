// Reads Claude Code transcripts (<config>/projects/*/<session>.jsonl) into what the ledger needs:
// your prompts, the agent's tool calls with their outcome, and its replies. No dependencies.
// The mod tags the prompts into requirements; this only reads.
//
//   node import.mjs <projects dir> <out.json> [--days N] [--max N] [--skip id,id] [--session id]

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const [projectsDir, outFile, ...rest] = process.argv.slice(2)
if (!projectsDir || !outFile) {
  console.error('usage: import.mjs <projects dir> <out.json> [--days N] [--max N] [--skip id,id] [--session id]')
  process.exit(2)
}
const opt = name => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const days = Number(opt('days') ?? 2)
const max = Number(opt('max') ?? 12)
const skip = new Set((opt('skip') ?? '').split(',').filter(Boolean))
const only = opt('session')

// Only the fields the ledger turns into events; file contents and diffs are dropped.
const KEEP = ['file_path', 'notebook_path', 'command', 'description', 'pattern', 'url', 'query', 'plan', 'todos']

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Text you typed, without the reminders and command wrappers the app adds around it.
function humanText(content) {
  const blocks = typeof content === 'string' ? [content] : (content ?? []).filter(b => b?.type === 'text').map(b => b.text)
  // Reminders are cut out rather than dropping their block: the app can put one in front of your text.
  return blocks
    .map(t => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
    .filter(t => !/^\s*<(local-command|command-|ide_|user-prompt-submit-hook)/.test(t))
    .join('\n')
    .trim()
}

async function readTranscript(file) {
  const out = { sessionId: path.basename(file, '.jsonl'), cwd: '', title: '', firstAt: 0, lastAt: 0, prompts: [], tools: [], replies: [] }
  const byId = new Map()
  let lastReply = ''
  // Set when the app's startup context says another session started this one.
  let startedBySession = false
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!startedBySession && line.includes('You are a session started from another session')) startedBySession = true
    let j
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.type === 'custom-title' && j.customTitle) out.title = j.customTitle
    // A message sent while the agent was working is stored as a queued command, not a prompt.
    if (j.type === 'attachment' && j.attachment?.type === 'queued_command' && j.attachment.origin?.kind === 'human' && !j.isSidechain) {
      const text = humanText(String(j.attachment.prompt ?? ''))
      const at = Date.parse(j.attachment.timestamp ?? j.timestamp ?? '') || 0
      if (text && !text.startsWith('/')) out.prompts.push({ at, text: clip(text, 3000), lastReply: clip(lastReply, 1500), whileWorking: true })
      continue
    }
    if (j.isSidechain || !j.message) continue
    const at = Date.parse(j.timestamp ?? '') || 0
    if (at) {
      out.firstAt ||= at
      out.lastAt = Math.max(out.lastAt, at)
    }
    if (j.cwd && !out.cwd) out.cwd = j.cwd
    const content = j.message.content
    if (j.type === 'user') {
      const blocks = Array.isArray(content) ? content : []
      for (const b of blocks) {
        if (b?.type !== 'tool_result') continue
        const t = byId.get(b.tool_use_id)
        if (t) t.isError = Boolean(b.is_error)
      }
      const isHuman = j.origin?.kind === 'human' || j.turnOrigin === 'human'
      // A session started by another session gets its whole task as a first message from that
      // session: you asked for it there, so it's read as yours (and kept longer: briefs run long).
      // Kept only if the session turns out to have been started that way: a claude -p run starts
      // the same way, but is a script, not something you asked for.
      const isBrief = !isHuman && !j.isMeta && !out.prompts.length && !out.replies.length && j.turnOrigin === 'sdk'
      if ((isHuman || isBrief) && !j.isMeta) {
        const text = humanText(content)
        if (text && !text.startsWith('/')) out.prompts.push({ at, text: clip(text, isBrief ? 12000 : 3000), lastReply: clip(lastReply, 1500), ...(isBrief ? { fromSession: true } : {}) })
      }
    } else if (j.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'text' && b.text?.trim()) {
          lastReply = b.text.trim()
          if (b.text.trim().length > 40) out.replies.push({ at, text: clip(b.text.trim(), 2000) })
        } else if (b?.type === 'tool_use') {
          const input = b.input ?? {}
          const t = { tool: b.name, tool_use_id: b.id, at }
          for (const k of KEEP) {
            if (input[k] === undefined) continue
            t[k] = typeof input[k] === 'string' ? clip(input[k], 1500) : input[k]
          }
          byId.set(b.id, t)
          out.tools.push(t)
        }
      }
    }
  }
  // Every prompt and reply, from the first: early requirements are the ones most easily lost.
  // Only tool calls are capped (they feed the activity list, not requirements).
  out.tools = out.tools.slice(-250)
  if (!startedBySession) out.prompts = out.prompts.filter(p => !p.fromSession)
  return out
}

function transcripts() {
  const files = []
  for (const project of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const dir = path.join(projectsDir, project.name)
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const id = f.slice(0, -6)
      if (only ? id !== only : skip.has(id)) continue
      const file = path.join(dir, f)
      files.push({ file, mtime: fs.statSync(file).mtimeMs })
    }
  }
  const since = Date.now() - days * 24 * 3600 * 1000
  return files
    .filter(f => only || f.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime)
}

// The newest sessions with something you said: headless runs and empty sessions don't take a place.
const sessions = []
for (const { file } of transcripts()) {
  if (sessions.length >= (only ? 1 : max)) break
  try {
    const s = await readTranscript(file)
    if (s.prompts.length) sessions.push(s)
  } catch (err) {
    console.error(`skipped ${file}: ${err.message}`)
  }
}
// "-" hands the result straight back on stdout, so nothing is left on disk.
if (outFile === '-') {
  process.stdout.write(JSON.stringify(sessions))
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(sessions))
  console.log(`${sessions.length} sessions`)
}
