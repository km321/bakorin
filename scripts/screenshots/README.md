# Admin screenshots

Reproduces the admin screenshots on the website and in the docs. Every name,
company, and address in the demo is fictional (`.example` domains).

```bash
# 1. Start the demo project (a fresh data folder each time)
cp -r scripts/screenshots/demo /tmp/demo
node scripts/screenshots/receiver.mjs &      # webhook receiver on :4599
BAKORIN_ADMIN_EMAIL=avery@fernwood.example BAKORIN_ADMIN_PASSWORD=demo-password-fernwood-1 \
BAKORIN_MCP_TOKEN=demo-mcp-token-fictional-0123456789abcdef \
  bun packages/server/src/cli.ts dev --dir /tmp/demo &

# 2. Seed data, then keep a few realtime streams open
cd scripts/screenshots && npm i --no-save playwright sharp
node seed.mjs && node extra.mjs && node ship.mjs
DEMO_DB=/tmp/demo/data/app.db bun files.mjs   # PDF briefs and unused files for the Files shots
node live.mjs &

# 3. Capture light and dark (wait a minute after seeding: login is rate limited)
OUT=/tmp/shots node capture.mjs
OUT=/tmp/shots node capture2.mjs
# Branded shots: add a branding section to app.yaml (see the Branding docs), then
BRANDED=1 OUT=/tmp/shots node capture.mjs
```

Copy the `.webp` files you need into `website/src/assets/screens/`. Astro
resizes them at build time.
