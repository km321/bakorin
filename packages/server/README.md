# @bakorin/server

The Bakorin API and `bakorin` CLI. Requires [Bun](https://bun.sh) 1.1 or newer.

```bash
bunx --bun bakorin init ./my-app
cd my-app
bunx --bun bakorin dev
```

Or from a checkout: `bun packages/server/src/cli.ts dev`.

Programmatic:

```ts
import { createRuntime } from "@bakorin/server";

const runtime = await createRuntime({
  projectDir: ".",
  yamlSource: await Bun.file("app.yaml").text(),
});
```

This package is published on the npm `beta` tag. See `PUBLISHING.md` in the repo root. Do not `npm publish` until you intend a public beta.
