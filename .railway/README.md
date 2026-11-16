# Railway configuration

`railway.ts` describes the Railway service: the Dockerfile build, the `/health`
check, restart on failure (5 tries), and a volume mounted at `/data`. It replaces
`railway.json` and `railway.toml`, which Railway stops reading on 2026-12-01.

```bash
bun add -d railway      # once, for railway/iac
railway link            # pick the project and environment
railway config plan     # preview what would change
railway config apply    # apply after you confirm
```

`railway config plan` needs the Railway SDK next to this folder: run
`bun add -d railway` (or `npm install -D railway`) once.

Variables stay in the Railway dashboard (`variables: { managed: false }`), so a
plan never shows or removes secrets. Check that a plan does not delete or replace
the volume before you apply it.
