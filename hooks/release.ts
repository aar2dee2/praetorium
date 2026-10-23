// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.2',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "20f1e1f7eeb9ece94862ea1918e8aba12e23dc81ea750baa0717382543f9c8a4",
    "praetorium-darwin-x64": "b60034244851e0afb7aabe202208fa75f428e4136549acc9ab3a2e84120f8043",
    "praetorium-linux-x64": "efcda8a374f98f3f607a28bfd5d87a2e309574087c0f6c77415482a1204736c8",
    "praetorium-linux-arm64": "1728fcf020cbb6ba6928fffa8e2cc262fbe192a1d792efc551245631039cb77a",
    "praetorium-windows-x64.exe": "66317c1482dde6ddbe55d31283ee6093fea5c811a21becdf7841797327f308b8"
  },
}
