// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.0',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "8d5442c462c5179edaf90e778074f2babe7dd9364782332c48195ce06e16f8d5",
    "praetorium-darwin-x64": "e279ba6eb3434ed034316e5ffc670e47a59e3982c8aaf97d17363c56f3ca2cae",
    "praetorium-linux-x64": "d50f8759ab335914621f9934cc7bafd8ec764351dc7f1eb2d5a120dce686eaa0",
    "praetorium-linux-arm64": "5dbd5654c0633a5161ff9d3caf808b705f9bbb391f154125e0f65780cece7425",
    "praetorium-windows-x64.exe": "761019c20d9fe489e53e6c17ab6ff7b2ae72693dcb59afcf422fe12c33ffc69d"
  },
}
