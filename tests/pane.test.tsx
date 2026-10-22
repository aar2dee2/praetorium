import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'ledger',
  viewport: { columns: 80, rows: 50 },
  props: { title: 'Ledger', isFocused: false, bodyColumns: 76, placement: 'dock' },
} as const

describe('ledger', () => {
  test('pane draws all three tabs on desktop and terminal', async $ => {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'praetorium', surface, ...PANE } as never)
      expect(await ui.find({ type: 'Text', text: /Requirements are tagged/ })).toBeDefined()
      await ui.press({ key: 'tab-activity' })
      expect(await ui.find({ type: 'Text', text: /No activity yet/ })).toBeDefined()
      await ui.press({ key: 'tab-audit' })
      expect(await ui.find({ type: 'Text', text: /does not count/ })).toBeDefined()
      await ui.press({ key: 'tab-reqs' })
      await ui.unmount()
    }
  })
})

describe('ledger wide', () => {
  test('wide pane shows the three columns side by side', async $ => {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'praetorium', surface, component: 'Pane', requestId: 'ledger',
        viewport: { columns: 200, rows: 50 },
        props: { title: 'Ledger', isFocused: false, bodyColumns: 196, placement: 'dock' },
      } as never)
      expect(await ui.find({ type: 'Text', text: /Completion audit/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /No activity yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
