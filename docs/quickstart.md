# Quickstart (about five minutes)

Spin up Bakorin as the API for an Astro or Next.js site.

Install [Bun](https://bun.sh) first.

macOS / Linux:

```bash
curl -fsSL https://bun.sh/install | bash
```

Windows (PowerShell):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Create a project

Packages are on npm under the `beta` tag.

```bash
bun create bakorin@beta my-app --frontend astro --template todo --yes
cd my-app
cp .env.example .env
bun install
```

`npm create bakorin@beta -- my-app --frontend astro --template todo --yes` and `pnpm create bakorin@beta my-app --frontend astro --template todo --yes` also work. So does `npx create-bakorin@beta my-app`.

Set `JWT_SECRET` in `.env` to the output of `openssl rand -base64 48` (`bakorin start` refuses to boot without a strong secret). `--mail log|resend|smtp` (or `--email`) writes `MAIL_DRIVER`, `MAIL_FROM`, and an empty `RESEND_API_KEY=` placeholder. Never paste a real key into git. Resend: [Email with Resend](resend.md).

Start the API from the project folder:

```bash
bun run dev
```

The API listens on http://127.0.0.1:4371. Health: `GET /health`. Admin: http://127.0.0.1:4371/admin/. Docs: http://127.0.0.1:4371/docs.

Open `/admin/` and create your first admin (email + password, min 8). Or set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` before the first start.

```bash
cd my-app/web
npm install
npm run dev
```

Astro defaults to http://127.0.0.1:4321. Next.js defaults to http://127.0.0.1:3000. `BAKORIN_URL` defaults to http://127.0.0.1:4371.

## From source

```bash
git clone https://github.com/km321/bakorin.git
cd bakorin
bun install
bun run create my-app --frontend astro --template todo --yes
cp my-app/.env.example my-app/.env
# set JWT_SECRET in my-app/.env
bun run dev -- --dir my-app
```

## Schema choices

- `blank` / `auth-only`: users only
- `todo`: users plus a private `tasks` list (the starters use this)

Flags: `--frontend astro|next|none`, `--schema blank|auth-only|todo`, `--mail log|resend|smtp`, `--sdk local|npm`, `--force`, `--yes`, `--help`.
