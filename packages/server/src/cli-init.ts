/** bakorin init: the starter app.yaml, hooks.ts, and .env.example. */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import templateYaml from "./templates/app.yaml" with { type: "text" };
import templateHooks from "./templates/hooks.ts" with { type: "text" };
import { projectDir } from "./cli-args.ts";

const TEMPLATE_YAML = templateYaml;
const TEMPLATE_HOOKS = templateHooks as unknown as string;

export async function cmdInit(): Promise<void> {
  const dir = resolve(process.argv[3] && !process.argv[3].startsWith("-") ? process.argv[3] : projectDir());
  await mkdir(dir, { recursive: true });
  const yamlPath = join(dir, "app.yaml");
  if (await Bun.file(yamlPath).exists()) {
    console.error("app.yaml already exists; refusing to overwrite");
    process.exit(1);
  }
  await Bun.write(yamlPath, TEMPLATE_YAML);
  await Bun.write(join(dir, "hooks.ts"), TEMPLATE_HOOKS);
  await Bun.write(join(dir, ".env.example"), envExampleTemplate());
  await Bun.write(
    join(dir, ".gitignore"),
    `data
.env
*.db
*.db-wal
*.db-shm
`,
  );
  console.log(`Initialized Bakorin project in ${dir}`);
  console.log("Next: cd there, set JWT_SECRET for production, then run bakorin dev");
}

function envExampleTemplate(): string {
  return `# Required for bakorin start: 32+ random characters. Generate one with: openssl rand -base64 48
# bakorin dev works without it and prints a warning.
JWT_SECRET=
PORT=4371
APP_URL=http://localhost:4321
CORS_ORIGINS=http://localhost:4321,http://localhost:3000

# First admin. Leave empty to create one at /admin/ on first run.
BAKORIN_ADMIN_EMAIL=
BAKORIN_ADMIN_PASSWORD=
BAKORIN_ADMIN_NAME=

MAIL_DRIVER=log
MAIL_FROM=

# --- Optional: production, Railway, S3, Postgres, extra mail ---
BAKORIN_DATA_DIR=
BAKORIN_ENV=
NODE_ENV=
# Set to 1 behind one proxy such as Railway, or a comma list of proxy CIDRs. Empty trusts no proxy.
TRUST_PROXY=
DATABASE_URL=
JWT_SECRET_PREVIOUS=
# Placeholder only. Paste a Resend API key locally. Never commit a real key.
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
BUCKET=
S3_BUCKET=
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=auto
S3_ADDRESSING_STYLE=path
S3_FORCE_PATH_STYLE=true
AWS_ENDPOINT_URL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=auto
`;
}
