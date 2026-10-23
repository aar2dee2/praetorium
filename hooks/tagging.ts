// Tagging a prompt into requirements. Pure, so the live check (scripts/live-check.mjs)
// sends the model exactly what the mod sends.

export type Tagged = { title: string; quote: string; refines: string | null; conflicts?: string | null; conflict_reason?: string; revisit?: string | null }

export const TAG_SYSTEM =
  'You split a developer\'s message to a coding agent into atomic, checkable requirements. ' +
  'Reply with JSON only: {"items":[{"title":string,"quote":string,"refines":string|null,"conflicts":string|null,"conflict_reason":string}]}. ' +
  'title: imperative, at most 12 words. quote: the exact words from the message it comes from. ' +
  'refines: the id of an existing requirement ONLY when this message explicitly revises that same requirement (same feature, new detail or correction). ' +
  'A different feature is a new item (refines null), even when it is related or touches the same screen. When in doubt, refines is null. ' +
  'conflicts: the id of an existing requirement this message contradicts (asks for the opposite, or for something both cannot be true at once), else null; ' +
  'conflict_reason: one short sentence saying what clashes. A refinement that simply replaces the old wording is not a conflict. ' +
  'revisit: when the user accepts something as good enough for now but names a time or condition to come back to it ("okay for now", "we can increase it later if…", "revisit when…"), that condition as a short phrase (e.g. "if contributor activity grows"); else null. Only when the message is about that very requirement; then set refines to it. ' +
  'Different properties are different requirements: how to install something and what it depends on, or what a page shows and how it looks, are separate items even when they touch the same thing. ' +
  'Read the message in the light of the agent\'s previous reply when one is given: it is usually a reaction to it. ' +
  'A request phrased as a question ("how do I make it…", "can we…", "could you…", "why isn\'t X…") IS a requirement: state the outcome the user wants. ' +
  '"Can we not get X", "couldn\'t we X", "why not X" and "shouldn\'t it X" ask FOR X: the title is X, never its opposite. ' +
  'Not requirements: questions asked only to understand (how something works, what it costs, why it behaved as it did), approvals ("yes", "go ahead", "continue"), and chit-chat. ' +
  'If a message asks for a change, include it even when it is worded loosely. ' +
  'Examples. "Can we not show it in a separate window?" → [{"title":"Show it in a separate window"}]. ' +
  '"Why not keep the old colours?" → [{"title":"Keep the old colours"}]. ' +
  '"What does this cost per request?" → []. "How does the audit decide what is verified?" → []. ' +
  'With R12 "Install by pasting a few lines": "can we have a setup without node?" → [{"title":"Remove the Node dependency","refines":null}] (a new requirement, not a refinement of R12). ' +
  'Reply {"items":[]} when there is no requirement.'

// `lastReply` is the agent's previous answer: the message is often a reaction to it, and
// phrasings like "can we not get X" only read one way in context.
export function tagPrompt(existing: { id: string; title: string }[], text: string, lastReply = ''): string {
  const list = existing.length ? existing.map(r => `${r.id}: ${r.title}`).join('\n') : '(none)'
  const reply = lastReply.trim() ? `The agent's previous reply (context only, not requirements):\n${lastReply.trim().slice(-1500)}\n\n` : ''
  return `Existing requirements:\n${list}\n\n${reply}Message:\n${text}`
}

export function parseTagged(reply: string): Tagged[] {
  try {
    const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
    const items = (JSON.parse(json) as { items?: Tagged[] }).items ?? []
    return items.filter(i => typeof i.title === 'string' && i.title.trim())
  } catch {
    return []
  }
}

// ---------- a whole past conversation at once (/ledger import, resumed sessions) ----------

export type PastPrompt = { at: number; text: string; lastReply: string }
export type BackfillItem = { id: string; title: string; quote: string; msg: number; refines: string | null }

export const BACKFILL_SYSTEM =
  'You read a developer\'s messages to a coding agent, in order, and list the requirements they asked for. ' +
  'Reply with JSON only: {"items":[{"id":string,"title":string,"quote":string,"msg":number,"refines":string|null}]}. ' +
  'Number ids R1, R2… in the order you list them. title: imperative, at most 12 words. quote: the exact words. ' +
  'msg: the number of the message it comes from. refines: the id of an earlier item this later message changes or corrects, else null. ' +
  'Each message is shown after the agent\'s reply it answers; read it in that light. ' +
  'A request phrased as a question ("how do I…", "can we…", "can we not get X" asking FOR X) is a requirement. ' +
  'Not requirements: questions asked only to understand, approvals ("yes", "go ahead"), and chit-chat. ' +
  'Merge repeats of the same ask into one item.'

export function backfillPrompt(prompts: PastPrompt[]): string {
  return prompts
    .map((p, i) => `${p.lastReply ? `[agent before message ${i + 1}]: ${p.lastReply}\n` : ''}[message ${i + 1}]: ${p.text}`)
    .join('\n\n')
}

export function parseBackfill(reply: string, count: number): BackfillItem[] {
  let items: BackfillItem[]
  try {
    const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
    items = (JSON.parse(json) as { items?: BackfillItem[] }).items ?? []
  } catch {
    // A reply cut off mid-list: keep every item that arrived whole.
    items = [...reply.matchAll(/\{[^{}]*"title"[^{}]*\}/g)].flatMap(m => {
      try {
        return [JSON.parse(m[0]) as BackfillItem]
      } catch {
        return []
      }
    })
  }
  return items.filter(i => typeof i.title === 'string' && i.title.trim() && Number.isInteger(i.msg) && i.msg >= 1 && i.msg <= count)
}

// ---------- after each turn: what the agent found, and whether it went against a requirement ----------

export type TurnReview = {
  findings: { text: string }[]
  conflicts: { id: string; reason: string }[]
}

export const REVIEW_SYSTEM =
  'You review a coding agent\'s report to its user for things the user would want to act on and might miss in a long chat. ' +
  'Reply with JSON only: {"findings":[{"text":string}],"conflicts":[{"id":string,"reason":string}]}. ' +
  'findings: at most 4, each one sentence: something new, surprising or unexpected the agent discovered (a bug elsewhere, a wrong assumption, ' +
  'a risky state, data loss, a limitation it hit, a decision it made that the user did not ask for, something it could not do). ' +
  'Not findings: routine progress ("I edited X", "tests pass"), plans, or restating the request. ' +
  'conflicts: requirements (by id) that what the agent did or decided goes against, with a one-sentence reason. ' +
  'Reply {"findings":[],"conflicts":[]} when there is nothing.'

export function reviewPrompt(reqs: { id: string; title: string }[], answer: string): string {
  const list = reqs.length ? reqs.map(r => `${r.id}: ${r.title}`).join('\n') : '(none)'
  return `Requirements:\n${list}\n\nThe agent's report:\n${answer.slice(-6000)}`
}

export function parseReview(reply: string): TurnReview {
  try {
    const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
    const r = JSON.parse(json) as Partial<TurnReview>
    return {
      findings: (r.findings ?? []).filter(f => typeof f?.text === 'string' && f.text.trim()).slice(0, 4),
      conflicts: (r.conflicts ?? []).filter(c => typeof c?.id === 'string' && typeof c?.reason === 'string'),
    }
  } catch {
    return { findings: [], conflicts: [] }
  }
}
