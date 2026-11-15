# create-bakorin

Scaffold a Bakorin backend (and optional Astro or Next.js starter) in one command.

From a Bakorin checkout (until npm publish):

```bash
bun install
bun run create my-app --frontend astro --schema todo --yes
bun run create --help
```

After publish:

```bash
npx create-bakorin my-app
npx create-bakorin my-app --frontend astro --schema todo --yes
npx create-bakorin my-app --frontend astro --schema todo --mail resend --yes
npx create-bakorin my-app --frontend next --schema auth-only --yes
npx create-bakorin api-only --frontend none --schema blank --yes
```

Flags:

- `--name` project name
- `--dir` output directory (defaults to the project name)
- `--frontend` `astro` | `next` | `none`
- `--schema` `blank` | `auth-only` | `todo`
- `--mail` (or `--email`) `log` | `resend` | `smtp`
- `--sdk` `local` | `npm` (default: `local` from a Bakorin checkout, `npm` after publish)
- `--force` write into a non-empty existing folder
- `--yes` skip prompts
- `--help` / `-h` print usage and exit without writing files

`--mail resend` writes `MAIL_DRIVER=resend`, a `MAIL_FROM` example on `your-domain.com`, and an empty `RESEND_API_KEY=` placeholder. Never commit a real key.

From a checkout, the generated `web/package.json` points `@bakorin/sdk` at this repo's `packages/sdk` via a `file:` path, and the Dockerfile vendors `.bakorin/` so the image can start without npm. After publish, `--sdk npm` (the default outside a checkout) uses `@bakorin/sdk@^0.0.1` and `bunx bakorin`.

This package is publish-ready on the npm `beta` tag. Do not `npm publish` until you intend a public beta. See `PUBLISHING.md`.
