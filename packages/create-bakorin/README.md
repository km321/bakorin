# create-bakorin

Scaffold a Bakorin backend (and optional Astro or Next.js starter) in one command.

```bash
npx create-bakorin my-app
npx create-bakorin my-app --frontend astro --schema todo --yes
npx create-bakorin my-app --frontend next --schema auth-only --yes
npx create-bakorin api-only --frontend none --schema blank --yes
```

Flags:

- `--name` project name
- `--frontend` `astro` | `next` | `none`
- `--schema` `blank` | `auth-only` | `todo`
- `--yes` skip prompts
- `--dir` output directory (defaults to the project name)

This package is publish-ready. Do not `npm publish` from this repo until you intend a public release.
