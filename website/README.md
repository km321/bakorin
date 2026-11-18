# Bakorin website and docs

Static Astro site with Starlight docs. Marketing pages live at `/` and `/why/`, docs at `/docs/`.

```bash
cd website
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Output is fully static (`output: "static"`), with no adapter, Functions, or server.

## Preview deploy

This preview is noindexed. Every page sends `noindex` (meta tag plus an `X-Robots-Tag` header from `public/_headers`) and `robots.txt` disallows everything. Remove those before any public launch.

```bash
npx wrangler pages deploy dist --project-name bakorin-preview --branch main
```

Docs content is in `src/content/docs/docs/`. Keep it accurate to the code in `packages/`. Mark anything not built yet as Planned.
