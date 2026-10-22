// Tagging a prompt into requirements. Pure, so the live check (scripts/live-check.mjs)
// sends the model exactly what the mod sends.

export type Tagged = { title: string; quote: string; refines: string | null }

export const TAG_SYSTEM =
  'You split a developer\'s message to a coding agent into atomic, checkable requirements. ' +
  'Reply with JSON only: {"items":[{"title":string,"quote":string,"refines":string|null}]}. ' +
  'title: imperative, at most 12 words. quote: the exact words from the message it comes from. ' +
  'refines: the id of an existing requirement this changes or corrects, else null. ' +
  'Read the message in the light of the agent\'s previous reply when one is given: it is usually a reaction to it. ' +
  'A request phrased as a question ("how do I make it…", "can we…", "could you…", "why isn\'t X…") IS a requirement: state the outcome the user wants. ' +
  '"Can we not get X", "couldn\'t we X", "why not X" and "shouldn\'t it X" ask FOR X: the title is X, never its opposite. ' +
  'Not requirements: questions asked only to understand (how something works, what it costs, why it behaved as it did), approvals ("yes", "go ahead", "continue"), and chit-chat. ' +
  'If a message asks for a change, include it even when it is worded loosely. ' +
  'Examples. "Can we not show it in a separate window?" → [{"title":"Show it in a separate window"}]. ' +
  '"Why not keep the old colours?" → [{"title":"Keep the old colours"}]. ' +
  '"What does this cost per request?" → []. "How does the audit decide what is verified?" → []. ' +
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
