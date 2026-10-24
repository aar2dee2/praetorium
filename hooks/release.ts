// The standalone principia program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.4.0',
  repo: 'aar2dee2/principia',
  sha256: {
    "principia-darwin-arm64": "223777a601c0351899c8ca89d35396f6d6edcf11d7ec95f09185c5657cd14dc7",
    "principia-darwin-x64": "0789007ebfe14f989c66e6b69ea3c773c0414598b81b8a51ec2f7e64b26a9e5a",
    "principia-linux-x64": "58aec355a3b47ea5afc1de615be361fa8d7e1d3483ef4f8c7437bb925b33dfc1",
    "principia-linux-arm64": "617a2ebb217b21f0e03d9f1c3f51da5a3743ab58e749d1e89c2263516d219a8f",
    "principia-windows-x64.exe": "793994f6f834ae4aeed91f7cb1de4b6551a34649053c71842bd027447c887e03"
  },
}
