# Contributing to electron-glasskit

Thanks for helping out. This is a macOS native addon (C++ N-API shim plus Swift) with a TypeScript API.

## Prerequisites

- **macOS 26 or newer with Xcode 26 or newer.** The native addon needs the macOS 26 SDK to compile. Check with `xcrun --sdk macosx --show-sdk-version`.
- **Node.js 20 or newer.** CI and releases use the version in `.node-version` (the current LTS).
- **pnpm 12.** The exact version is pinned in the `packageManager` field; `corepack enable` picks it up.

Only the native build, the Swift tests and the end-to-end tests need macOS. Everything else runs anywhere.

## Setup

```bash
git clone https://github.com/OpenSource03/electron-glasskit.git
cd electron-glasskit
pnpm install
node node_modules/electron/install.js   # fetches the Electron binary if install did not (safe to repeat)
pnpm build:native                       # builds the native addon for this machine's architecture
pnpm build                              # builds the TypeScript library into dist/
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/main` | The main-process API: hosts, regions, groups, islands, panels, and the server side of the DOM bindings |
| `src/renderer`, `src/react`, `src/preload` | The DOM bindings, the React components and the preload bridge |
| `src/shared` | Option types, the island node schema and the IPC protocol |
| `native/swift/Core` | The per-window host, glass views and the C interface |
| `native/swift/Islands` | The renderer that turns a node tree into SwiftUI |
| `native/addon.cc` | The N-API shim between JavaScript and Swift |
| `test/unit`, `test/e2e`, `native/swift-tests` | Unit tests, tests in real Electron, and tests for the Swift code |
| `examples/kitchen-sink` | Every feature in one window |

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Bundles the TypeScript library into `dist/` with tsdown |
| `pnpm build:native` | Builds `prebuilds/darwin-<arch>/glasskit.node` for the host architecture. Pass `--arch arm64,x64` to build both: `pnpm build:native --arch arm64,x64` |
| `pnpm build:all` | `build:native` then `build` |
| `pnpm typecheck` | Type-checks with `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | Checks, or fixes, formatting and lint rules with Biome |
| `pnpm test` | Unit tests (Vitest); run anywhere |
| `pnpm test:swift` | Swift tests; macOS only |
| `pnpm test:e2e` | Launches Electron against the real native addon; macOS only, needs `pnpm build` and `pnpm build:native` first |
| `pnpm check:package` | Validates the published package shape with publint and Are the Types Wrong; needs `pnpm build` first |
| `pnpm example` | Runs the example app |

Before opening a pull request, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. For native changes also run `pnpm build:native`, `pnpm test:swift` and `pnpm test:e2e`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `master` and every pull request:

- **check** (Linux): lint, typecheck, unit tests, build and package checks.
- **native** (macOS 26 runner, Xcode 26): builds both architectures, Swift tests, end-to-end tests, and uploads `prebuilds/` as an artifact.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`).
- Keep pull requests focused, fill in the template, and add a line to `CHANGELOG.md` under **Unreleased** for user-visible changes.
- Native code: keep UI work on the main thread and comment any private API use.

## Releases

Releases are published by `.github/workflows/release.yml` when a `v*.*.*` tag is pushed.

1. Set `version` in `package.json` and move the **Unreleased** changelog entries under that version. Merge to `master`.
2. Optionally rehearse: in the GitHub Actions tab run **Release** manually. It defaults to a dry run that does everything except publish (it ends with `npm publish --dry-run`).
3. Tag and push: `git tag v<version> && git push origin v<version>`. The tag must equal `v` plus the `package.json` version or the workflow fails immediately.

The workflow then lints, type-checks and tests, builds the native addon for arm64 and x64 on a macOS runner, runs the Swift and end-to-end tests, checks the package, publishes to npm with provenance, and creates a GitHub Release with generated notes and the prebuilt `.node` files attached.

Versions with a prerelease suffix (for example `0.2.0-beta.1`) publish under the `next` dist-tag and are marked as prereleases. Everything else publishes as `latest`.

### Publishing credentials

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no long-lived token is needed in steady state. A trusted publisher can only be configured for a package that already exists, so the first release needs a token:

1. Create a granular npm access token that can publish, and store it as the repository secret `NPM_TOKEN`. The workflow uses it automatically when the secret is set.
2. Push the first release tag (`v0.1.0`).
3. On npmjs.com open the package, then **Settings** and **Trusted Publisher**, choose GitHub Actions, and enter owner `OpenSource03`, repository `electron-glasskit`, workflow filename `release.yml`, and no environment. Under **Allowed actions** include `npm publish`; new configurations default to `npm stage publish` only, which this workflow does not use. The configuration expires unless a publish succeeds within 2 days, so do this right before the next release.
4. After a release has gone out through OIDC (the job log says "Publishing with npm trusted publishing"), delete the `NPM_TOKEN` secret, revoke the token, and under **Publishing access** choose "Require two-factor authentication and disallow tokens".

Trusted publishing needs npm 11.5.1 or newer and Node 22.14 or newer; the workflow checks this. Provenance is generated automatically for OIDC publishes from a public repository.

## Getting help

Open an [issue](https://github.com/OpenSource03/electron-glasskit/issues). Be respectful and constructive.
