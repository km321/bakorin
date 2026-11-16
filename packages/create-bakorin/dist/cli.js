#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/cli.ts
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = dirname(fileURLToPath(import.meta.url));
var TEMPLATES = join(ROOT, "..", "templates");
var CHECKOUT_ROOT = resolve(ROOT, "../../..");
var CHECKOUT_SDK = resolve(ROOT, "../../sdk");
var NPM_SDK = "^0.0.1";
var USAGE = `create-bakorin [name] [options]

Scaffold a Bakorin backend and an optional Astro or Next.js starter.

Usage:
  create-bakorin my-app
  create-bakorin my-app --frontend astro --schema todo --yes
  bun run create my-app --frontend astro --schema todo --yes

Options:
  --name <name>           Project name (defaults to the first argument)
  --dir <path>            Output directory (defaults to the project name)
  --frontend, --fw        astro | next | none (default: astro)
  --schema, --starter     blank | auth-only | todo (default: todo)
  --mail, --email         log | resend | smtp (default: log)
  --sdk                   local | npm
                          local: file: path to this checkout's packages/sdk
                          npm: @bakorin/sdk@^0.0.1 (after publish)
                          Default: local when run from a Bakorin checkout, else npm
  --force                 Write into a non-empty existing folder
  --yes, -y               Skip prompts
  --help, -h              Print this help and exit without writing files
`;
function arg(flag) {
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    return process.argv[index + 1];
  }
  return;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function parseFrontend(value) {
  if (value === "astro" || value === "next" || value === "none") {
    return value;
  }
  return;
}
function parseSchema(value) {
  if (value === "blank" || value === "auth" || value === "auth-only") {
    return value === "auth-only" ? "auth" : value === "auth" ? "auth" : "blank";
  }
  if (value === "todo" || value === "leads" || value === "todo/leads") {
    return "todo";
  }
  return;
}
function parseMail(value) {
  if (value === "log" || value === "resend" || value === "smtp") {
    return value;
  }
  if (value === "email" || value === "none") {
    return "log";
  }
  return;
}
function parseSdk(value) {
  if (value === "local" || value === "npm") {
    return value;
  }
  return;
}
async function detectCheckoutSdk() {
  try {
    const pkg = await readFile(join(CHECKOUT_SDK, "package.json"), "utf8");
    if (pkg.includes("@bakorin/sdk")) {
      return CHECKOUT_SDK;
    }
  } catch {
    return null;
  }
  return null;
}
function toFileRef(fromDir, targetDir) {
  let rel = relative(fromDir, targetDir);
  if (!rel || rel === "") {
    rel = ".";
  }
  rel = rel.split(sep).join("/");
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return `file:${rel}`;
}
function mailFromHeader(appName, mail) {
  switch (mail) {
    case "resend":
      return `${appName} <noreply@your-domain.com>`;
    case "smtp":
      return `${appName} <noreply@your-domain.com>`;
    case "log":
      return `${appName} <noreply@localhost>`;
    default: {
      const _never = mail;
      return _never;
    }
  }
}
function envExample(appName, mail) {
  return `JWT_SECRET=change-me-to-a-long-random-string
PORT=4371
APP_URL=http://localhost:4321
CORS_ORIGINS=http://localhost:4321,http://localhost:3000

# First admin. Leave empty to create one at /admin/ on first run.
BAKORIN_ADMIN_EMAIL=
BAKORIN_ADMIN_PASSWORD=
BAKORIN_ADMIN_NAME=

MAIL_DRIVER=${mail}
MAIL_FROM=${mailFromHeader(appName, mail)}

# --- Optional: production, Railway, S3, Postgres, extra mail ---
BAKORIN_DATA_DIR=
BAKORIN_ENV=
NODE_ENV=
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
function dockerfileFor(mode) {
  if (mode === "local") {
    return `FROM oven/bun:1.4
WORKDIR /bakorin
COPY .bakorin/package.json ./
COPY .bakorin/packages ./packages
RUN bun install
WORKDIR /project
COPY app.yaml hooks.ts ./
COPY mail ./mail
COPY branding ./branding
ENV NODE_ENV=production
ENV BAKORIN_ENV=production
ENV BAKORIN_DATA_DIR=/data
EXPOSE 4371
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4371)+'/health').then(r=>process.exit(r.ok?0:1))"
CMD ["bun", "/bakorin/packages/server/src/cli.ts", "start", "--dir", "/project"]
`;
  }
  return `FROM oven/bun:1.4
WORKDIR /project
COPY app.yaml hooks.ts ./
COPY mail ./mail
COPY branding ./branding
ENV NODE_ENV=production
ENV BAKORIN_ENV=production
ENV BAKORIN_DATA_DIR=/data
EXPOSE 4371
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4371)+'/health').then(r=>process.exit(r.ok?0:1))"
RUN bun add @bakorin/server@0.0.1
CMD ["bunx", "--bun", "bakorin", "start"]
`;
}
function dockerignore() {
  return `data
web
node_modules
.bakorin/node_modules
.env
.git
`;
}
function slug(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bakorin-app";
}
async function prompt(question, fallback) {
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${question} (${fallback}): `);
  rl.close();
  return answer.trim() || fallback;
}
function isLicenseFile(name) {
  return /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name);
}
async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".astro" || entry.name === ".next") {
        continue;
      }
      await copyDir(src, dest);
    } else if (entry.name === "README.md" || isLicenseFile(entry.name)) {
      continue;
    } else {
      await cp(src, dest);
    }
  }
}
async function writeTemplated(src, dest, name) {
  const text = (await readFile(src, "utf8")).replaceAll("{{APP_NAME}}", name);
  await writeFile(dest, text);
}
async function resolveFrontendTemplate(kind) {
  const packaged = join(TEMPLATES, kind);
  try {
    await readdir(packaged);
    return packaged;
  } catch {
    return resolve(ROOT, "../../../examples", `${kind}-starter`);
  }
}
function schemaFile(schema) {
  switch (schema) {
    case "blank":
      return "blank.yaml";
    case "auth":
      return "auth.yaml";
    case "todo":
      return "todo.yaml";
    default: {
      const _never = schema;
      return _never;
    }
  }
}
async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
async function isNonEmptyDir(path) {
  try {
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}
async function copyFiltered(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".turbo") {
      continue;
    }
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyFiltered(src, dest);
    } else {
      await cp(src, dest);
    }
  }
}
async function vendorRuntime(dest) {
  const vendor = join(dest, ".bakorin");
  await mkdir(join(vendor, "packages"), { recursive: true });
  await writeFile(join(vendor, "package.json"), `${JSON.stringify({
    name: "bakorin-runtime",
    private: true,
    type: "module",
    workspaces: ["packages/core", "packages/server"]
  }, null, 2)}
`);
  await copyFiltered(join(CHECKOUT_ROOT, "packages/core"), join(vendor, "packages/core"));
  await copyFiltered(join(CHECKOUT_ROOT, "packages/server"), join(vendor, "packages/server"));
}
async function rewriteSdkDependency(webDir, sdk, checkoutSdk) {
  const pkgPath = join(webDir, "package.json");
  if (!await pathExists(pkgPath)) {
    return;
  }
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  delete pkg.license;
  const spec = sdk === "local" && checkoutSdk ? toFileRef(webDir, checkoutSdk) : NPM_SDK;
  pkg.dependencies = { ...pkg.dependencies, "@bakorin/sdk": spec };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}
`);
}
var MAIL_NOTES = `# mail/

Email templates for the mail rules in app.yaml and for ctx.mail.send in hooks.ts.

- \`<name>.html\` and/or \`<name>.txt\`: the body, with {{ record.field }} placeholders
- \`<name>.subject\`: optional subject when the rule has no subject:
- \`_layout.html\`: optional wrapper with {{{ body }}}
- \`_auth/verify.html\`, \`_auth/reset.html\`, \`_auth/invite.html\`: optional overrides for account emails

The Dockerfile copies this folder into the image. Preview with: bakorin mail preview <template>
`;
var BRANDING_NOTES = `# branding/

Optional white label. Put a logo and favicon here and add a branding section to app.yaml:

\`\`\`yaml
branding:
  name: Client Name
  primaryColor: "#0f766e"
  accentColor: "#f59e0b"
  logo: branding/logo.svg
  favicon: branding/favicon.png
\`\`\`

Without that section the admin, /docs, and system emails keep the default Bakorin look.
Colors are adjusted automatically if they would fail WCAG AA contrast, and boot logs a warning.
Use a png logo if your emails matter; many email clients do not show svg.
Backups include this folder. See docs/branding in the Bakorin docs.
`;
function projectReadme(appName, options, sdk) {
  const apiStart = sdk === "local" ? `From the Bakorin checkout that generated this project:

   \`\`\`bash
   bun run dev -- --dir ${relative(CHECKOUT_ROOT, resolve(options.directory)) || "."}
   \`\`\`

   Or, from this folder after \`bun install\` in the checkout: \`bun ../../packages/server/src/cli.ts dev --dir .\`` : `\`\`\`bash
   bunx bakorin dev
   \`\`\``;
  return `# ${appName}

Bakorin backend generated by create-bakorin.

## Run locally

1. Copy \`.env.example\` to \`.env\` and set \`JWT_SECRET\`.
   Email provider is \`${options.mail}\` (\`MAIL_DRIVER\`). For Resend, paste \`RESEND_API_KEY\` locally and set \`MAIL_FROM\` to a verified domain. Never commit a real key.
2. Start the API:

   ${apiStart}

3. Open http://127.0.0.1:4371/admin/ and create your first admin (email + password, min 8 characters).
${options.frontend === "none" ? "" : `
4. In another terminal, start the ${options.frontend} app in \`web/\`:

   \`\`\`bash
   cd web
   npm install
   npm run dev
   \`\`\`

   \`BAKORIN_URL\` defaults to http://127.0.0.1:4371.
`}

## Branding (optional)

Add a \`branding:\` section to \`app.yaml\` with your client's name, colors, logo, and favicon. The files go in \`branding/\`. See \`branding/README.md\`.

Railway: mount a volume at \`/data\`, set \`BAKORIN_DATA_DIR=/data\` and \`JWT_SECRET\`. See the Bakorin checkout file \`docs/deploy-railway.md\`.
`;
}
async function run(options) {
  const dest = resolve(options.directory);
  if (await isNonEmptyDir(dest) && !options.force) {
    throw new Error(`Refusing to write into non-empty folder ${dest}. Pass --force to overwrite.`);
  }
  await mkdir(dest, { recursive: true });
  const appName = slug(options.name);
  const checkoutSdk = await detectCheckoutSdk();
  const sdk = options.sdk;
  if (sdk === "local" && !checkoutSdk) {
    throw new Error(" --sdk local needs a Bakorin checkout with packages/sdk. Use --sdk npm after publish.");
  }
  await writeTemplated(join(TEMPLATES, "schemas", schemaFile(options.schema)), join(dest, "app.yaml"), appName);
  await cp(join(TEMPLATES, "hooks.ts"), join(dest, "hooks.ts"));
  await writeFile(join(dest, ".env.example"), envExample(appName, options.mail));
  await cp(join(TEMPLATES, "gitignore"), join(dest, ".gitignore"));
  const gitignore = await readFile(join(dest, ".gitignore"), "utf8");
  if (!gitignore.includes(".bakorin/node_modules")) {
    await writeFile(join(dest, ".gitignore"), `${gitignore.trimEnd()}
.bakorin/node_modules
`);
  }
  await writeFile(join(dest, "Dockerfile"), dockerfileFor(sdk));
  await writeFile(join(dest, ".dockerignore"), dockerignore());
  await cp(join(TEMPLATES, "railway.json"), join(dest, "railway.json"));
  await cp(join(TEMPLATES, "railway.toml"), join(dest, "railway.toml"));
  await cp(join(TEMPLATES, "docker-compose.yml"), join(dest, "docker-compose.yml"));
  await writeFile(join(dest, "README.md"), projectReadme(appName, options, sdk));
  await mkdir(join(dest, "mail"), { recursive: true });
  await writeFile(join(dest, "mail", "README.md"), MAIL_NOTES);
  await mkdir(join(dest, "branding"), { recursive: true });
  await writeFile(join(dest, "branding", "README.md"), BRANDING_NOTES);
  if (sdk === "local") {
    await vendorRuntime(dest);
  }
  if (options.frontend !== "none") {
    const from = await resolveFrontendTemplate(options.frontend);
    const webDir = join(dest, "web");
    await copyDir(from, webDir);
    await rewriteSdkDependency(webDir, sdk, checkoutSdk);
    await writeFile(join(webDir, "README.md"), `# ${appName} web

\`\`\`bash
cd web
npm install
npm run dev
\`\`\`

\`BAKORIN_URL\` defaults to http://127.0.0.1:4371.
`);
  }
  console.log(`Created ${dest}`);
  console.log(`Schema: ${options.schema}   Frontend: ${options.frontend}   Mail: ${options.mail}   SDK: ${sdk}`);
  console.log("Next: copy .env.example to .env, then start Bakorin with bun run dev -- --dir <folder>");
  console.log("Optional: white label the admin with a branding section in app.yaml (see branding/README.md).");
}
async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const positional = process.argv.slice(2).find((item) => !item.startsWith("-"));
  const yes = hasFlag("--yes") || hasFlag("-y") || !process.stdin.isTTY;
  const force = hasFlag("--force");
  let name = arg("--name") ?? positional ?? "";
  let frontend = parseFrontend(arg("--frontend") ?? arg("--fw"));
  let schema = parseSchema(arg("--schema") ?? arg("--starter"));
  let mail = parseMail(arg("--mail") ?? arg("--email") ?? arg("--email-provider"));
  let sdk = parseSdk(arg("--sdk"));
  if (!yes) {
    if (!name) {
      name = await prompt("Project name", "my-app");
    }
    if (!frontend) {
      const raw = await prompt("Frontend (astro | next | none)", "astro");
      frontend = parseFrontend(raw) ?? "astro";
    }
    if (!schema) {
      const raw = await prompt("Starter schema (blank | auth-only | todo)", "todo");
      schema = parseSchema(raw) ?? "todo";
    }
    if (!mail) {
      const raw = await prompt("Email provider (log | resend | smtp)", "log");
      mail = parseMail(raw) ?? "log";
    }
  }
  name = name || "my-app";
  frontend = frontend ?? "astro";
  schema = schema ?? "todo";
  mail = mail ?? "log";
  if (!sdk) {
    sdk = await detectCheckoutSdk() ? "local" : "npm";
  }
  const directory = arg("--dir") ?? name;
  await run({ name, directory, frontend, schema, mail, yes, force, sdk });
}
if (__require.main == __require.module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
export {
  USAGE,
  detectCheckoutSdk,
  envExample,
  run
};
