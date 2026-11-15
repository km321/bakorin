# Quickstart (about five minutes)

Spin up Bakorin as the API for an Astro or Next.js site.

## 1. Scaffold

```bash
npx create-bakorin my-app --frontend astro --schema todo --yes
npx create-bakorin my-app --frontend astro --schema todo --mail resend --yes
cd my-app
cp .env.example .env
```

Set `JWT_SECRET` in `.env` to a long random string. `--mail log|resend|smtp` (or `--email`) writes `MAIL_DRIVER`, `MAIL_FROM`, and an empty `RESEND_API_KEY=` placeholder. Never paste a real key into git. Resend walkthrough: [Email with Resend](resend.md).

## 2. Start the API

From a Bakorin checkout (this repo is not published to npm yet):

```bash
bun packages/server/src/cli.ts dev --dir ./my-app
```

After a public release you can use `bunx bakorin dev` instead.

The API listens on http://127.0.0.1:4371. Health: `GET /health`. Admin: http://127.0.0.1:4371/admin/. Docs: http://127.0.0.1:4371/docs.

## 3. Start the front end

```bash
cd my-app/web
npm install
npm run dev
```

Astro defaults to http://127.0.0.1:4321. Next.js defaults to http://127.0.0.1:3000. `BAKORIN_URL` defaults to http://127.0.0.1:4371.

Create an account, then open `/app` and add a record.

## 4. Promote an admin (optional)

```bash
sqlite3 my-app/data/app.db "update users set role = 'admin' where email = 'you@example.com';"
```

Or set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` on first boot.

## Schema choices

- `blank` / `auth-only`: users only
- `todo`: users plus a private `tasks` list (the starters use this)

Flags: `--frontend astro|next|none`, `--schema blank|auth-only|todo`, `--mail log|resend|smtp`, `--yes`.
