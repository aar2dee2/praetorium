import { describe, expect, test } from 'claude-code/testing'

import type { Requirement } from '../types'
import { filterReqs, gapOf, linkStep, planFrom, previewUrls } from '../hooks/work'
import { parseReview, parseTagged } from '../hooks/tagging'

const req = (id: string, title: string, extra: Partial<Requirement> = {}): Requirement => ({
  id, title, status: 'captured', at: 1, history: [{ at: 1, text: title, kind: 'original', by: 'you' }], evidence: [], ...extra,
})
const REQS = [
  req('R1', 'Wrap text in the requirements column'),
  req('R2', 'Store data outside the temp folder', { status: 'verified' }),
  req('R3', 'Add search and filters for requirements', { conflict: { reason: 'later message asks to drop search', at: 2, source: 'you' } }),
  req('R4', 'Explain tmp sessions', { history: [{ at: 1, text: 'x', kind: 'original', by: 'agent' }] }),
]

describe('plans', () => {
  test('a step names its requirements, or is matched by title', async () => {
    expect(linkStep('[R1, R3] Rework the columns', REQS)).toEqual(['R1', 'R3'])
    expect(linkStep('Add search box and filters for requirements list', REQS)).toEqual(['R3'])
    expect(linkStep('Refactor the build script', REQS)).toEqual([])
  })
  test('TodoWrite and the desktop plan tool both become steps', async () => {
    const a = planFrom({ todos: [{ content: '[R1] wrap', status: 'in_progress' }] }, REQS)
    const b = planFrom({ items: [{ content: 'Store data outside the temp folder', status: 'completed' }] }, REQS)
    expect(a?.[0]).toEqual({ text: '[R1] wrap', status: 'in_progress', reqIds: ['R1'] })
    expect(b?.[0]?.reqIds).toEqual(['R2'])
  })
  test('requirements the plan leaves out are a gap', async () => {
    const plan = [{ text: 'x', status: 'pending' as const, reqIds: ['R1'] }]
    expect(gapOf(REQS[3]!, plan)).toBe("Not in the agent's plan")
    expect(gapOf(REQS[2]!, plan)).toContain('Conflicting instruction')
    expect(gapOf(REQS[1]!, plan)).toBe('')
  })
})

describe('signals and previews', () => {
  test('preview links come from command output', async () => {
    const out = '  ➜  Local:   http://localhost:5173/\n  Network: http://0.0.0.0:3000.\nDeployed to https://app-git-main.vercel.app ok'
    expect(previewUrls(out)).toEqual(['http://localhost:5173/', 'http://localhost:3000', 'https://app-git-main.vercel.app'])
  })
  test('a review keeps findings and conflicts, and survives a bad reply', async () => {
    const r = parseReview('{"findings":[{"text":"The cache is shared across users"}],"conflicts":[{"id":"R2","reason":"wrote to /tmp"}]}')
    expect(r.findings.length).toBe(1)
    expect(r.conflicts[0]?.id).toBe('R2')
    expect(parseReview('not json')).toEqual({ findings: [], conflicts: [] })
  })
  test('the tagger can flag a conflict', async () => {
    const t = parseTagged('{"items":[{"title":"Remove search","quote":"drop search","refines":null,"conflicts":"R3","conflict_reason":"R3 adds search"}]}')
    expect(t[0]?.conflicts).toBe('R3')
  })
})

describe('requirement search and filters', () => {
  test('search reads ids, titles and your words', async () => {
    expect(filterReqs(REQS, 'temp', 'all').map(r => r.id)).toEqual(['R2'])
    expect(filterReqs(REQS, 'r4', 'all').map(r => r.id)).toEqual(['R4'])
  })
  test('filters', async () => {
    expect(filterReqs(REQS, '', 'verified').map(r => r.id)).toEqual(['R2'])
    expect(filterReqs(REQS, '', 'conflicts').map(r => r.id)).toEqual(['R3'])
    expect(filterReqs(REQS, '', 'agents').map(r => r.id)).toEqual(['R4'])
    expect(filterReqs(REQS, '', 'open').map(r => r.id)).toEqual(['R1', 'R3', 'R4'])
  })
})

import { isSecretPath } from '../hooks/work'
import { launchCommand } from '../hooks/platform'

describe('safety', () => {
  test('files that may hold secrets are never copied', async () => {
    for (const f of ['/app/.env', '/app/.env.local', 'C:\\app\\.npmrc', '/home/a/.ssh/id_ed25519', '/k/server.pem', '/k/tls.key', '/app/credentials.json', '/app/secrets.yaml'])
      expect(isSecretPath(f)).toBe(true)
    for (const f of ['/app/src/env.ts', '/app/keyboard.tsx', '/app/README.md', '/app/environment.md'])
      expect(isSecretPath(f)).toBe(false)
  })
  test('Windows runs the program directly, with an unquoted one-word title', async () => {
    const l = launchCommand('windows', { id: 'cmd', name: 'Command Prompt' }, ['C:/Users/A B/praetorium.exe', 'view', 'C:/Users/A B/.claude/praetorium'], 'Praetorium', 'C:/Users/A B')
    expect(l?.cmd).toEqual(['cmd', '/c', 'start', 'Praetorium', 'C:/Users/A B/praetorium.exe', 'view', 'C:/Users/A B/.claude/praetorium'])
  })
})

describe('env files', () => {
  test('every common env-file name counts as secret', async () => {
    for (const f of ['.env', '.env.local', '.env.production', '.env.development.local', '/repo/apps/web/.env.test', 'C:\\repo\\.env'])
      expect(isSecretPath(f)).toBe(true)
  })
})

describe('done for now, to revisit', () => {
  test('counts as accounted for, not a gap, and has its own filter', async () => {
    const r = req('R9', 'Run audits twice a week', { status: 'revisit', revisit: 'if contributor activity grows' })
    expect(gapOf(r, [])).toBe('')
    expect(filterReqs([...REQS, r], '', 'revisit').map(x => x.id)).toEqual(['R9'])
    expect(filterReqs([...REQS, r], '', 'open').map(x => x.id)).not.toContain('R9')
  })
  test('the tagger can mark a requirement to revisit', async () => {
    const t = parseTagged('{"items":[{"title":"Keep audits twice a week for now","quote":"twice a week is okay for now","refines":"R44","conflicts":null,"revisit":"if contributor activity grows"}]}')
    expect(t[0]?.revisit).toBe('if contributor activity grows')
  })
})
