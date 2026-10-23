// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.7',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "75c15b52b78626538091bf267f52e3f3f32e626db8bea423afa19d2db11d3a9f",
    "praetorium-darwin-x64": "a2743d62f0483d102e63a35105199816fcd4a93879ac12f9494fc37f1d7e7808",
    "praetorium-linux-x64": "5186b45c3a1c139c6907d1b1ca1761248a3d4cab717d04a5b3b9c5d37ff5044e",
    "praetorium-linux-arm64": "4ee6c0e4187a659313d82aa74085a7532816913c86954f433d54e481caefbaf6",
    "praetorium-windows-x64.exe": "7cd3fd270a9987df47a20b62c1c2776ca6d90abbab4ee9975bb23d007b15c3ad"
  },
}
