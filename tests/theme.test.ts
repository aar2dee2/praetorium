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

import { parseBackfill } from '../hooks/tagging'

describe('backfill replies', () => {
  test('a reply cut off mid-list keeps the items that arrived whole', async () => {
    const cut = '{"items":[{"id":"R1","title":"Show sessions","quote":"q","msg":1,"refines":null},{"id":"R2","title":"Use iTerm","quote":"q","msg":2,"refines":"R1"},{"id":"R3","title":"Half'
    const items = parseBackfill(cut, 3)
    expect(items.map(i => i.id)).toEqual(['R1', 'R2'])
  })
})
