// The standalone principia program published with this version: written by scripts/build.ts
// when a release is cut, and checked against before anything downloaded is run.
export const RELEASE: { version: string; repo: string; sha256: Record<string, string> } = {
  version: '0.4.2',
  repo: 'aar2dee2/principia',
  sha256: {
    "principia-darwin-arm64": "1f4bcb0524e3614e93cf0969c7793a98f5800e7f32e15078c5e3a4ec721b6be6",
    "principia-darwin-x64": "94eca6c37455e2df23fb77cb83aca3183d54409139e4a9d5a8ca64a9db1fab7b",
    "principia-linux-x64": "b59cee77949c5988e55e4c0d3353dfa7b759c9145a9fcda57604b3584c0bc576",
    "principia-linux-arm64": "46ce83404de38b2b45f41d829b21b976b126a55c7c22dfa479d5ac94b566e874",
    "principia-windows-x64.exe": "a03ed9e1c7e6f2ad5552926ad18b385aedce4a85e6fca218d439bdca460baeeb"
  },
}
