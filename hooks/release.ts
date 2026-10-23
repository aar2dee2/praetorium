// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.3',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "c4479d5fb2a0edc6bf6e0b1c9561c512616c93b6de62550f6c8fda0b3c28aa4e",
    "praetorium-darwin-x64": "8367b65200302ce261016ee100eb7040b92d6bd348fa3053096546fcd2bf63b2",
    "praetorium-linux-x64": "35eef2e43b6555869087b0f4b4b725167cbed56fd159bb9bfbdc95dfc362c79b",
    "praetorium-linux-arm64": "5e73d5b48aaf487b664cb23885b756bc6c685247d0ea936fdceaf59146e46e39",
    "praetorium-windows-x64.exe": "fefe0a114abeb8c3c7df0000c89325974e3eb99ff2fe41138232caf57aecadc1"
  },
}
