import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_THEME, PRESETS, colourLines, contrast, normalizeTheme, palette } from '../hooks/theme'

describe('themes', () => {
  test('every preset keeps text readable in both modes', async () => {
    for (const theme of Object.values(PRESETS)) {
      for (const mode of ['dark', 'light'] as const) {
        expect(contrast(theme[mode].text, theme[mode].bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('an imported theme fills gaps and replaces unreadable colours', async () => {
    const t = normalizeTheme({ name: 'acme', dark: { bg: '#000000', text: '#050505', done: 'not a colour', active: '#22d3ee' } })
    expect(t.name).toBe('acme')
    expect(t.dark.text).toBe(DEFAULT_THEME.dark.text)
    expect(t.dark.done).toBe(DEFAULT_THEME.dark.done)
    expect(t.dark.active).toBe('#22d3ee')
    expect(t.light).toEqual(DEFAULT_THEME.light)
  })

  test('dim backgrounds are derived from the accents', async () => {
    const p = palette(PRESETS.telborg!, true)
    expect(p.doneDim).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.mutedDim).toBe(PRESETS.telborg!.dark.surface2)
  })

  test('only colour lines of a config reach the model', async () => {
    const src = "module.exports = {\n  content: ['./src/**/*.tsx'],\n  theme: { extend: { colors: { brand: '#ff5500' } } },\n  plugins: [],\n}"
    const lines = colourLines(src)
    expect(lines).toContain('#ff5500')
    expect(lines).not.toContain('plugins')
  })
})

import { buildLedger, parseChunk } from '../hooks/tagging'

describe('backfill replies', () => {
  test('a reply cut off mid-list keeps the items that arrived whole', async () => {
    const cut = '{"items":[{"title":"Show sessions","quote":"q","msg":1,"refines":null,"status":"captured"},{"title":"Use iTerm","quote":"q","msg":2,"refines":"R1"},{"title":"Half'
    expect(parseChunk(cut).items.map(i => i.title)).toEqual(['Show sessions', 'Use iTerm'])
  })
  test('a long conversation is read whole: every chunk gets every requirement, statuses see every reply', async () => {
    const prompts = Array.from({ length: 20 }, (_, i) => ({ at: i * 10, text: i === 0 ? 'build the ledger' : `message ${i + 1}`, lastReply: '' }))
    const replies = [{ at: 5, text: 'started the ledger' }, { at: 195, text: 'the ledger is done and committed' }]
    const seen: { system: string; prompt: string }[] = []
    const built = await buildLedger(prompts, replies, async (system, prompt) => {
      seen.push({ system, prompt })
      if (system.includes('judge how far')) return '{"progress":[{"id":"R1","status":"implemented","why":"message 20: done and committed"}]}'
      if (seen.length === 1) return '{"items":[{"title":"Build the ledger","quote":"build the ledger","msg":1,"refines":null}]}'
      return '{"items":[]}'
    })
    const asks = seen.filter(x => x.system.includes('a few at a time'))
    expect(asks.length).toBe(3) // 20 messages in chunks of 8
    expect(asks[2]!.prompt).toContain('R1: Build the ledger') // later chunks are given the early requirement
    const status = seen.find(x => x.system.includes('judge how far'))!
    expect(status.prompt).toContain('the ledger is done and committed') // the late evidence is fed to the status pass
    expect(built.items.map(i => `${i.id}:${i.status}`)).toEqual(['R1:implemented'])
  })
  test('a call with no answer fails the whole build rather than half-read it', async () => {
    const prompts = Array.from({ length: 12 }, (_, i) => ({ at: i, text: `m${i}`, lastReply: '' }))
    let n = 0
    const built = await buildLedger(prompts, [], async () => (n++ ? undefined : '{"items":[]}'))
    expect(built.failed).toContain('messages 9-12')
  })
  test('the reason the model gave for not answering is kept in the failure', async () => {
    const prompts = Array.from({ length: 4 }, (_, i) => ({ at: i, text: `m${i}`, lastReply: '' }))
    const built = await buildLedger(prompts, [], async () => ({ reason: 'rate limited, after 3 tries' }))
    expect(built.failed).toBe('no answer (rate limited, after 3 tries) for messages 1-4')
  })
})
