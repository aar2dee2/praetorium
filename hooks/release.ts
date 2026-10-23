// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.6',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "55c28704afd06d1ea42a6fe82885193e6e530130321c61dc821892494fe8bbc1",
    "praetorium-darwin-x64": "50abd7e99bc8b435c74f0e72b9a3e2d5b1f166ea2d22b1fe40074d28c26c9100",
    "praetorium-linux-x64": "76233b8dcafd4273270fefe3017a011f881b6fcbb2e0cb29dc47a9e0e2f579a2",
    "praetorium-linux-arm64": "d9fe284ee39bdfe7d308764394899dd4eb12b6c8555aecfcb5033a9d63d3e38b",
    "praetorium-windows-x64.exe": "6dabefeedfdb3c447093b22637ab483ca0d2bcbfca0d6a4a3a438211ed0f8a4b"
  },
}
