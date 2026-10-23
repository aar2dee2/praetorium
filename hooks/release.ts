// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.5',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "7538dd4313f383a9ddd852b0cdf60cd3eae9cb82e5150a3af9bf391cb0c794b4",
    "praetorium-darwin-x64": "7fa5a4e3a45b19ff8407801d0d9eeda82f1e7a5be27c9730639b00280fa79ce8",
    "praetorium-linux-x64": "872e13c683ac1f8a8f3bb325e367f115ac0acf280a0fdf8eee316c522aa505e7",
    "praetorium-linux-arm64": "50c704db6692f14a68923e1a4a44556ed2b53f90c8fa6b06b3d9d85b297be64e",
    "praetorium-windows-x64.exe": "4f617ee589a22d7dafe5cae97eebc72d0eab75bcb29ddb1cdd635dbfaccb9a67"
  },
}
