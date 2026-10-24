// Builds the standalone principia program for each platform and records each file's
// SHA-256 in hooks/release.ts, which the plugin checks before it runs a download.
//
//   bun scripts/build.ts            build into dist/
//   gh release create v<version> dist/principia-*    publish (after committing release.ts)

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8')).version as string
const targets: [string, string][] = [
  ['bun-darwin-arm64', 'principia-darwin-arm64'],
  ['bun-darwin-x64', 'principia-darwin-x64'],
  ['bun-linux-x64', 'principia-linux-x64'],
  ['bun-linux-arm64', 'principia-linux-arm64'],
  ['bun-windows-x64', 'principia-windows-x64.exe'],
]

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
const sha256: Record<string, string> = {}
for (const [target, name] of targets) {
  const r = Bun.spawnSync(['bun', 'build', '--compile', '--minify', `--target=${target}`, `--define=PRINCIPIA_VERSION=${JSON.stringify(version)}`,
    'viewer/cli.mjs', '--outfile', `dist/${name}`], { stdout: 'inherit', stderr: 'inherit' })
  if (r.exitCode !== 0) throw new Error(`build failed for ${target}`)
  sha256[name] = createHash('sha256').update(readFileSync(`dist/${name}`)).digest('hex')
  console.log(`${name}  ${sha256[name]}`)
}

writeFileSync('hooks/release.ts', `// The standalone principia program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '${version}',
  repo: 'aar2dee2/principia',
  sha256: ${JSON.stringify(sha256, null, 4).replace(/\n}/, '\n  }')},
}
`)
console.log(`hooks/release.ts updated for ${version}`)
