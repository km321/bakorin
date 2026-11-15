# @bakorin/core

Compiler and schema AST for Bakorin `app.yaml`. Parses YAML, interpolates env, diffs schemas, and generates TypeScript types.

```ts
import { compileAppYaml, generateTypes } from "@bakorin/core";

const ast = compileAppYaml(yamlSource, { env: process.env });
const types = generateTypes(ast);
```

This package is published on the npm `beta` tag. See `PUBLISHING.md` in the repo root. Do not `npm publish` until you intend a public beta.

## License

AGPL-3.0-only. See `LICENSE`. Commercial licenses are available from Melton Studios.
