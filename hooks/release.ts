// The standalone praetorium program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.3.8',
  repo: 'aar2dee2/praetorium',
  sha256: {
    "praetorium-darwin-arm64": "37f6a550d56f6b1262bb2aa1c4d447620779d015e7e657ba66f452b091b777a9",
    "praetorium-darwin-x64": "052eb0250a7f4f9aa5a62489162b95b240f221ed86321de92e34d56abae5b329",
    "praetorium-linux-x64": "98c1508ab473e31fc49bf8e2d5dd64d767a7bfffc99d14ffc9641a7dde354f40",
    "praetorium-linux-arm64": "9cfa81a4e6234edf992f075713fb3492bb17d8262376ab375ebf2dc3340f898f",
    "praetorium-windows-x64.exe": "4386be843311e855836ff1c851d4d594eaeeb86260768d83626f6e733551b2c0"
  },
}
