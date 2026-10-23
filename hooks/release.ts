// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.4',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "7570cd28ac9bbe316fc824d2b52e88173703b0765cd595460948333a2850c14c",
    "praetorium-darwin-x64": "4d0bd35fe4ea93a6304b26fc4db8cc76dda3cb369c7538f5c8137bb651ccc1ff",
    "praetorium-linux-x64": "f7a781d8adf06995c17adeca42976f25fa7908c6d66bceb5238fedf755cac943",
    "praetorium-linux-arm64": "00a004b154b0860fac7a706656f288d202f3a5929ed0411a1b7710cc4e951792",
    "praetorium-windows-x64.exe": "5b2608295b3aaf8f379a172687b84913fabe8ab14dc30832748793574e79aa79"
  },
}
