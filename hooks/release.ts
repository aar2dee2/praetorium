// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.1',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "58ccf4ed7a2312c3b602c05728ac0c67b8ace827eef95f9cb4b5ebe1f8b65157",
    "praetorium-darwin-x64": "c5f897c3217f7c0f6675a43af4f7e616ee99fd7ede054c809552004cba00c9e9",
    "praetorium-linux-x64": "df3e14a1ff37c039ca67c9efc3bed87137dee23af36415a9e0a5a4e8f41fd7a4",
    "praetorium-linux-arm64": "660ab7c552227ba9e93ca355f383a3cea000e7e0e5204f4d47e056552dfa14bf",
    "praetorium-windows-x64.exe": "328a652eb99a128540c51356c0413317dba47a68d99869baaadf40cffeae780b"
  },
}
