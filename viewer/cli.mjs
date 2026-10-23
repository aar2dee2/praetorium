// The praetorium program: the ledger window, the transcript importer and the diff view.
// Built into one standalone file per platform with `bun build --compile` (scripts/build.ts),
// so nothing else needs installing; while developing, `bun viewer/cli.mjs …` runs the source.
//
//   praetorium view <data dir> [session id] [projects dir]
//   praetorium import <projects dir> <out.json> [--days N] [--max N] [--skip ids] [--session id]
//   praetorium diff <snapshot or ''> <file>

const [cmd, ...args] = process.argv.slice(2)

// How to start this same program again (the window restarts itself on update).
const script = process.argv[1] ?? ''
const isCompiled = script.startsWith('/$bunfs') || script.startsWith('B:\\~BUN') || !/\.(m?js|ts)$/.test(script)
globalThis.PRAETORIUM = { args, self: isCompiled ? [process.execPath] : [process.execPath, script], isCompiled }

if (cmd === 'view') {
  await import('./ledger-view.mjs')
} else if (cmd === 'import') {
  process.argv = [process.argv[0], 'import', ...args]
  await import('./import.mjs')
} else if (cmd === 'diff') {
  const { showDiff } = await import('./diff.mjs')
  showDiff(args[0] ?? '', args[1] ?? '')
  process.exit(0)
} else if (cmd === '--version' || cmd === 'version') {
  console.log('praetorium 0.3.0')
} else {
  console.error('usage: praetorium view <data dir> [session] [projects dir] | import … | diff <snapshot> <file>')
  process.exit(2)
}
