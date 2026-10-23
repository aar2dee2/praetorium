// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.0',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "c25fac4d5bda0e5ec2339e860c2c47adb79efc46f1c125bed8e23d1e5241293e",
    "praetorium-darwin-x64": "bfa373a09a86a662ef89f738b306773a7487256c505eb0affb1d656f2584f9c9",
    "praetorium-linux-x64": "185fbb758136b80077309534687d56c64e2e140857b9b75aac01efed71016bb5",
    "praetorium-linux-arm64": "90c91673f4ba42dfab3d7c0af419cc753521b85e0a35efd4ab94fb6a46192357",
    "praetorium-windows-x64.exe": "aca2dcc3a09ad87194a847497ef035c6785d8b90253ef0d5d467622c732651df"
  },
}
