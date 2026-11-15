# Publishing Bakorin packages (beta)

Do not publish until you intend a public npm beta. This repo is private. Publishing makes `@bakorin/sdk`, `@bakorin/core`, `@bakorin/server`, and `create-bakorin` downloadable by anyone.

Packages are version `0.0.1`. `publishConfig` is `access: public` and `tag: beta` so a default `npm install pkg` does not pick them up until you later promote a `latest` tag.

## Packages

| Package | Directory |
|---|---|
| `@bakorin/core` | `packages/core` |
| `@bakorin/sdk` | `packages/sdk` |
| `@bakorin/server` | `packages/server` (needs Bun) |
| `create-bakorin` | `packages/create-bakorin` |

`@bakorin/admin-ui` is private. It is baked into the server. Do not publish it.

## Build and dry-run

From the repo root, with npm 10+ on PATH:

```bash
bun install
bun run build:packages
bun scripts/npm-pack-check.ts
```

Or per package:

```bash
cd packages/core && bun run build && npm pack --dry-run
cd packages/sdk && bun run build && npm pack --dry-run
cd packages/server && bun run build && npm pack --dry-run
cd packages/create-bakorin && bun run build && npm pack --dry-run
```

Confirm `dist/`, `LICENSE`, and `README.md` are in the tarball. Source `src/` is included so Bun can import TypeScript. Confirm no `.env`, no real API keys, and no `node_modules`.

## Publish to the beta tag

Log in as the npm user that will own the `@bakorin` org (create the org first). Then, **core first** because `@bakorin/server` depends on it:

```bash
cd packages/core
bun run build
# bun publish rewrites workspace: protocol versions
bun publish --access public --tag beta

cd ../sdk
bun run build
bun publish --access public --tag beta

cd ../create-bakorin
bun run build
bun publish --access public --tag beta

cd ../server
# Replace workspace:* with the published core version if bun publish does not
bun run build
bun publish --access public --tag beta
```

Equivalent npm (after replacing `workspace:*` in `packages/server/package.json` with `0.0.1`):

```bash
npm publish --access public --tag beta
```

Install a beta:

```bash
npm install @bakorin/sdk@beta
npx create-bakorin@beta my-app --yes
bunx --bun @bakorin/server@beta
```

## Deprecate

Warn installers without removing the tarball:

```bash
npm deprecate @bakorin/sdk@0.0.1 "Use @bakorin/sdk@beta newer, or wait for latest."
```

Repeat for each package and version you want to mark.

## Unpublish (72 hours)

npm allows `npm unpublish <pkg>@<version>` only within 72 hours of that version, and only if no other package on the registry depends on it in a way npm blocks. After 72 hours you must deprecate instead.

```bash
npm unpublish @bakorin/sdk@0.0.1
npm unpublish @bakorin/core@0.0.1
npm unpublish @bakorin/server@0.0.1
npm unpublish create-bakorin@0.0.1
```

There is no undo. If someone already installed the version, their lockfile still points at the tarball until the registry 404s.

## Checklist before a real publish

1. `bun test` and `bun test tests/postgres.test.ts` are green.
2. `npm pack --dry-run` contents look right.
3. No secrets in the tarball (`gitleaks detect`).
4. GitHub repo `km321/bakorin` exists and `package.json` `repository` URLs match.
5. You are sure the npm account and `@bakorin` org are the ones you want.
