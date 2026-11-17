# Releasing Bakorin

Four packages are published to npm and always share one version number:

| Package | Directory | License |
|---|---|---|
| `@bakorin/core` | `packages/core` | AGPL-3.0-only |
| `@bakorin/server` | `packages/server` (needs Bun) | AGPL-3.0-only |
| `@bakorin/sdk` | `packages/sdk` | MIT |
| `create-bakorin` | `packages/create-bakorin` | MIT |

`@bakorin/admin-ui` is private. It is built into the server and is never published.

Versions are managed with [Changesets](https://github.com/changesets/changesets). The four packages are a `fixed` group in `.changeset/config.json`, so any change to one bumps all four. The repo is in prerelease mode with the `beta` tag (`.changeset/pre.json`), so releases come out as `0.1.0-beta.0`, `0.1.0-beta.1`, and so on, on the npm `beta` dist tag.

## Add a changeset

Do this in any PR that changes a published package:

```bash
bun run changeset
```

Pick the packages, pick `patch`, `minor` or `major`, and write one or two sentences for the changelog. Commit the new file in `.changeset/` with the PR. Docs, tests and website only changes do not need one.

## Cut a beta

1. Merge PRs with changesets into `main`.
2. The `release` workflow opens or updates a PR called "Version Packages". It bumps the versions, writes the CHANGELOG files and updates `bun.lock`. Review it like any PR. Note that PRs opened by the workflow token do not trigger CI on their own; push an empty commit to the PR branch or close and reopen it to run CI.
3. Merge the "Version Packages" PR. The `release` workflow runs again, finds nothing left to version, and publishes in this order: `@bakorin/core`, then `@bakorin/server` and `@bakorin/sdk`, then `create-bakorin`. It also creates a git tag and a GitHub release per package.

Users then install with `bun create bakorin@beta`.

To try the publish step without publishing, run the `release` workflow by hand from the Actions tab with `dry_run` checked (the default). Locally:

```bash
bun run pack:check                          # build, pack, check files and licenses
bun scripts/publish-packages.ts --dry-run   # npm publish --dry-run for all four
```

`scripts/publish-packages.ts` packs each package with `bun pm pack`, which replaces `workspace:` ranges with real versions, then uploads the tarball with `npm publish`. Versions that are already on the registry are skipped, so a failed release can be rerun. It publishes to whatever registry npm is configured for, which is how it was tested against a local verdaccio.

## Install the workflow (once)

The release workflow is in `ci/release.yml` for now. Move it into place and push from an account whose token has the `workflow` scope:

```bash
git mv ci/release.yml .github/workflows/release.yml
# delete the three "Waiting to be moved" comment lines at the top
git commit -m "Add release workflow" && git push
```

## npm setup (once)

Publishing uses npm trusted publishing (OIDC), so the workflow stores no npm token. Provenance is added automatically when the GitHub repository is public; npm does not generate provenance for private repositories.

A trusted publisher can only be added to a package that already exists on npm. So the first release goes like this:

1. On npmjs.com, create a granular access token with read and write access to the `bakorin` org packages and to `create-bakorin`, with a short expiry (for example 7 days). Granular tokens can publish without an OTP when "bypass 2FA" is allowed for the token.
2. Add it to the GitHub repo as the Actions secret `NPM_TOKEN`.
3. Merge the "Version Packages" PR. The workflow publishes `0.1.0-beta.0` using the token.
4. For each of the four packages, open npmjs.com, Packages, the package, Settings, Trusted publishing, and add a GitHub Actions publisher:
   - Organization or user: `km321`
   - Repository: `bakorin`
   - Workflow filename: `release.yml`
   - Environment: leave empty
   - Allowed actions: allow `npm publish` (new configurations only allow `npm stage publish` by default)
5. Delete the `NPM_TOKEN` secret and revoke the token. Optionally set each package to "Require two factor authentication and disallow tokens".

A new trusted publisher configuration must be used for a successful publish within 2 days or it expires. Add them shortly before the next release, or delete and recreate one that expired.

## Go to 1.0

1. Leave prerelease mode: `bunx changeset pre exit`, then add a changeset with a `major` bump for the four packages (from `0.x` this goes to `1.0.0`).
2. Remove `"tag": "beta"` from `publishConfig` in the four `package.json` files. The publish script picks the dist tag from the version anyway (`latest` for `1.0.0`), but the field would confuse a manual `npm publish`.
3. Merge, then merge the "Version Packages" PR. `1.0.0` is published on the `latest` tag.
4. Update docs that say `bakorin@beta` to plain `bakorin`.

To start another prerelease line later (for example `2.0.0-beta.0`), run `bunx changeset pre enter beta` again.
