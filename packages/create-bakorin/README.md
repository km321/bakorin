# create-bakorin

Scaffold a Bakorin backend (and optional Astro or Next.js starter) in one command.

```bash
npx create-bakorin my-app
npx create-bakorin my-app --frontend astro --schema todo --yes
npx create-bakorin my-app --frontend astro --schema todo --mail resend --yes
npx create-bakorin my-app --frontend next --schema auth-only --yes
npx create-bakorin api-only --frontend none --schema blank --yes
```

Flags:

- `--name` project name
- `--frontend` `astro` | `next` | `none`
- `--schema` `blank` | `auth-only` | `todo`
- `--mail` (or `--email`) `log` | `resend` | `smtp`
- `--yes` skip prompts
- `--dir` output directory (defaults to the project name)

`--mail resend` writes `MAIL_DRIVER=resend`, a `MAIL_FROM` example on `your-domain.com`, and an empty `RESEND_API_KEY=` placeholder. Never commit a real key.

This package is publish-ready on the npm `beta` tag. Do not `npm publish` until you intend a public beta. See `PUBLISHING.md`.
