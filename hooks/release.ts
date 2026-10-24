// The standalone principia program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.4.1',
  repo: 'aar2dee2/principia',
  sha256: {
    "principia-darwin-arm64": "c2662349fe3e4e1120170e8d17207c7ae245699d326801b28b80d8abc4e65190",
    "principia-darwin-x64": "8187af55571b5ec0d0743f8c49bae5c562cb5caa51939cfdccc2f2446e17c042",
    "principia-linux-x64": "329713a20316677b52d545b9533281391469443c72580397aa74cfe64c7edb3f",
    "principia-linux-arm64": "6f97da0fa87063b75c50e7c77c30b2ba26c505166b91e145bcc0b0873e5d19e4",
    "principia-windows-x64.exe": "26db9a608e9e61522575d62db5414715e21c77e21fd09f311c05e4ae44079979"
  },
}
