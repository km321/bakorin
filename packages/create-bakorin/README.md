# create-bakorin

Scaffold a Bakorin backend (and optional Astro or Next.js starter) in one command.

With Bun:

```bash
bun create bakorin@beta my-app
bun create bakorin@beta my-app --frontend astro --schema todo --yes
```

From a Bakorin checkout:

```bash
bun install
bun run create my-app --frontend astro --schema todo --yes
bun run create --help
```

Or with npm:

```bash
npx create-bakorin@beta my-app
npx create-bakorin@beta my-app --frontend astro --schema todo --yes
npx create-bakorin@beta my-app --frontend astro --schema todo --mail resend --yes
npx create-bakorin@beta my-app --frontend next --schema auth-only --yes
npx create-bakorin@beta api-only --frontend none --schema blank --yes
```

Flags:

- `--name` project name
- `--dir` output directory (defaults to the project name)
- `--frontend` `astro` | `next` | `none`
- `--schema` `blank` | `auth-only` | `todo`
- `--mail` (or `--email`) `log` | `resend` | `smtp`
- `--sdk` `local` | `npm` (default: `npm` from the published CLI, `local` from a Bakorin checkout)
- `--force` write into a non-empty existing folder
- `--yes` skip prompts
- `--help` / `-h` print usage and exit without writing files

`--mail resend` writes `MAIL_DRIVER=resend`, a `MAIL_FROM` example on `your-domain.com`, and an empty `RESEND_API_KEY=` placeholder. Never commit a real key.

With `--sdk npm` (the default when you run the published CLI), the project gets a `package.json` with `@bakorin/server` and `web/package.json` gets `@bakorin/sdk`, both at `^` this create-bakorin version (for example `^0.1.0-beta.0`). Run `bun install` and `bun run dev`. From a source checkout, `--sdk local` points `web/package.json` at this repo's `packages/sdk` via a `file:` path, and the Dockerfile vendors `.bakorin/` so the image can start without npm.

Every generated project has a `branding/` folder with notes. Add a `branding:` section to `app.yaml` (name, `primaryColor`, `accentColor`, `logo`, `favicon`) to white label the admin, `/docs`, and system emails. Without it the project looks like stock Bakorin. The Dockerfile copies `branding/` into the image.

Published on the npm `beta` tag. See `RELEASING.md` in the repo root.

## License

MIT. Copyright (c) 2026 Melton Studios. See `LICENSE`.
