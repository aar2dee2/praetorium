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
      await ui.press({ key: 'tab-signals' })
      expect(await ui.find({ type: 'Text', text: /Nothing to act on/ })).toBeDefined()
      await ui.press({ key: 'tab-plan' })
      expect(await ui.find({ type: 'Text', text: /No plan yet/ })).toBeDefined()
      await ui.press({ key: 'tab-tests' })
      expect(await ui.find({ type: 'Text', text: /No test, build or check runs/ })).toBeDefined()
      await ui.press({ key: 'tab-preview' })
      expect(await ui.find({ type: 'Text', text: /No previews yet/ })).toBeDefined()
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
      expect(await ui.find({ type: 'Text', text: /Signals \(0\)/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /No activity yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('transcript consent', () => {
  test('the dialog explains what is read, and Not now records a no', async ($, on) => {
    // The plugin's store, in memory, so the test can read what the dialog saved.
    const saved: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: saved[e.key] }))
    on('store.set', ($, e) => {
      saved[e.key] = e.value
      return { value: undefined }
    })
    on('store.delete', ($, e) => {
      delete saved[e.key]
      return { value: undefined }
    })
    on('store.keys', () => ({ value: Object.keys(saved) }))
    on('ui.close', () => ({ value: undefined }))
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'praetorium', surface, component: 'Pane', requestId: 'praetorium-consent',
        viewport: { columns: 80, rows: 30 },
        props: { title: 'Praetorium', isFocused: true, bodyColumns: 76, placement: 'dock' },
      } as never)
      expect(await ui.find({ type: 'Text', text: /before Praetorium/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /File contents are not kept/ })).toBeDefined()
      await ui.press({ key: 'consent-decline' })
      expect(saved.transcripts).toBe('declined')
      await ui.unmount()
    }
  })
})
