// src/ast.ts
var SCHEMA_AST_VERSION = 1;
var REALTIME_DEFAULTS = {
  broker: "auto",
  maxConnections: 1e4,
  maxPerUser: 20,
  heartbeatSeconds: 15,
  replayEvents: 1000,
  retainMinutes: 10,
  maxBufferKb: 1024
};
var MCP_DEFAULTS = { enabled: false, sampleLimit: 5 };
var WEBHOOK_DEFAULT_MAX_ATTEMPTS = 10;
var WEBHOOK_DEFAULT_TIMEOUT_MS = 1e4;
var WEBHOOK_DEFAULT_RETAIN_DAYS = 30;
var MAIL_DEFAULT_MAX_ATTEMPTS = 8;
var MAIL_DEFAULT_RETAIN_DAYS = 30;
var JOB_DEFAULT_RETAIN_DAYS = 30;
var JOB_DEFAULT_TIMEOUT_SECONDS = 300;
// src/compile.ts
import { parse as parseYaml } from "yaml";

// src/errors.ts
class BakorinError extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "BakorinError";
    this.code = code;
    this.details = details;
  }
}

class SchemaError extends BakorinError {
  constructor(message, details) {
    super("schema_invalid", message, details);
    this.name = "SchemaError";
  }
}

class DiffAbortError extends BakorinError {
  constructor(message, details) {
    super("diff_abort", message, details);
    this.name = "DiffAbortError";
  }
}

class IdentError extends BakorinError {
  constructor(message, details) {
    super("invalid_identifier", message, details);
    this.name = "IdentError";
  }
}

class DestructiveChangeError extends BakorinError {
  confirmCode;
  constructor(message, confirmCode, details) {
    super("destructive_change", message, details);
    this.name = "DestructiveChangeError";
    this.confirmCode = confirmCode;
  }
}

// src/branding.ts
var BRANDING_DIR = "branding";
var BRANDING_LOGO_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "webp"];
var BRANDING_FAVICON_EXTENSIONS = ["svg", "png", "ico"];
var BRANDING_MAX_FILE_BYTES = 1024 * 1024;
var BRANDING_SURFACES = {
  light: {
    text: "#1c1917",
    muted: "#57534e",
    surfaces: ["#f4f1ec", "#ebe6dd", "#fffcf8", "#efe8dc", "#f7f3ec", "#ffffff"],
    raised: "#fffcf8"
  },
  dark: {
    text: "#f3eee6",
    muted: "#b7b0a6",
    surfaces: ["#111315", "#0d0f12", "#181c20", "#1e242a", "#15191d", "#12161a"],
    raised: "#181c20"
  }
};
var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isHexColor(value) {
  return HEX.test(value);
}
function normalizeHex(value) {
  const raw = value.trim().toLowerCase();
  if (!HEX.test(raw)) {
    throw new Error(`${value} is not a hex color like #0f766e`);
  }
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return raw;
}
function toRgb(hex) {
  const value = normalizeHex(hex);
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}
function toHex(rgb) {
  return `#${rgb.map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0")).join("")}`;
}
function channel(value) {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgbToHsl([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) {
    return [l * 255, l * 255, l * 255];
  }
  const hue = (p, q, t) => {
    let tt = t;
    if (tt < 0)
      tt += 1;
    if (tt > 1)
      tt -= 1;
    if (tt < 1 / 6)
      return p + (q - p) * 6 * tt;
    if (tt < 1 / 2)
      return q;
    if (tt < 2 / 3)
      return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}
function minContrast(color, surfaces) {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
}
function ensureContrast(color, surfaces, target, direction) {
  const start = normalizeHex(color);
  if (minContrast(start, surfaces) >= target) {
    return start;
  }
  const [h, s, l] = rgbToHsl(toRgb(start));
  for (let step = 1;step <= 100; step += 1) {
    const nextL = direction === "darken" ? l - l * step / 100 : l + (1 - l) * step / 100;
    const candidate = toHex(hslToRgb([h, s, nextL]));
    if (minContrast(candidate, surfaces) >= target) {
      return candidate;
    }
  }
  return direction === "darken" ? "#000000" : "#ffffff";
}
function mix(a, b, amount) {
  const ra = toRgb(a);
  const rb = toRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i] * amount + rb[i] * (1 - amount)));
}
function bestForeground(background) {
  const light = "#ffffff";
  const dark = "#111111";
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}
function fmt(ratio) {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
function palette(primary, accent, theme, warnings, labels) {
  const spec = BRANDING_SURFACES[theme];
  const direction = theme === "light" ? "darken" : "lighten";
  const accentColor = ensureContrast(primary, spec.surfaces, 4.5, direction);
  if (accentColor !== primary) {
    warnings.push(`${labels.primary} ${primary} is ${fmt(minContrast(primary, spec.surfaces))} against the ${theme} theme, below the 4.5:1 WCAG AA minimum for text. Using ${accentColor} (${fmt(minContrast(accentColor, spec.surfaces))}) in ${theme} mode.`);
  }
  const focus = accent ? ensureContrast(accent, spec.surfaces, 3, direction) : accentColor;
  if (accent && focus !== accent) {
    warnings.push(`${labels.accent} ${accent} is ${fmt(minContrast(accent, spec.surfaces))} against the ${theme} theme, below the 3:1 minimum for focus rings. Using ${focus} in ${theme} mode.`);
  }
  let accentSoft = spec.raised;
  for (const amount of [0.16, 0.12, 0.08, 0.05, 0.03]) {
    const candidate = mix(accentColor, spec.raised, amount);
    if (contrastRatio(spec.text, candidate) >= 4.5 && contrastRatio(spec.muted, candidate) >= 4.5 && contrastRatio(accentColor, candidate) >= 4.5) {
      accentSoft = candidate;
      break;
    }
  }
  return { accent: accentColor, accentFg: bestForeground(accentColor), accentSoft, focus };
}
function normalizeBrandingPath(value) {
  return value.trim().replace(/^\.\//, "");
}
function compileBranding(raw) {
  if (!raw) {
    return;
  }
  const warnings = [];
  const out = { warnings };
  const name = raw.name?.trim();
  if (name) {
    out.name = name;
  }
  if (raw.logo) {
    out.logo = normalizeBrandingPath(raw.logo);
  }
  if (raw.favicon) {
    out.favicon = normalizeBrandingPath(raw.favicon);
  }
  if (raw.primaryColor || raw.accentColor) {
    const primary = normalizeHex(raw.primaryColor ?? raw.accentColor);
    const accent = raw.accentColor ? normalizeHex(raw.accentColor) : undefined;
    if (raw.primaryColor) {
      out.primaryColor = primary;
    }
    if (accent) {
      out.accentColor = accent;
    }
    const labels = {
      primary: raw.primaryColor ? "branding.primaryColor" : "branding.accentColor",
      accent: "branding.accentColor"
    };
    out.light = palette(primary, accent, "light", warnings, labels);
    out.dark = palette(primary, accent, "dark", warnings, labels);
    const emailPrimary = ensureContrast(primary, ["#ffffff"], 4.5, "darken");
    out.email = { primary: emailPrimary, primaryFg: bestForeground(emailPrimary) };
  }
  return out;
}
function brandName(appName, branding) {
  return branding?.name ?? appName;
}
function cssVars(p, prefix) {
  return [
    `${prefix}accent: ${p.accent};`,
    `${prefix}accent-fg: ${p.accentFg};`,
    `${prefix}accent-soft: ${p.accentSoft};`,
    `${prefix}focus: ${p.focus};`
  ].join(" ");
}
function brandingCss(branding) {
  if (!branding?.light || !branding.dark) {
    return "";
  }
  return [
    "/* Generated from the branding section of app.yaml. */",
    `:root, :root[data-theme="light"] { ${cssVars(branding.light, "--")} ${cssVars(branding.light, "--docs-")} }`,
    `:root[data-theme="dark"] { ${cssVars(branding.dark, "--")} ${cssVars(branding.dark, "--docs-")} }`,
    ""
  ].join(`
`);
}

// src/ident.ts
var IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
var RESERVED_PREFIX = "_bakorin";
var SQL_KEYWORDS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "from",
  "where",
  "table",
  "index",
  "drop",
  "alter",
  "create",
  "join",
  "union",
  "grant",
  "revoke",
  "pragma",
  "vacuum"
]);
function assertIdent(name, kind) {
  if (!IDENT.test(name)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is not a valid identifier`);
  }
  if (name.toLowerCase().startsWith(RESERVED_PREFIX)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} uses the reserved _bakorin prefix`);
  }
  if (SQL_KEYWORDS.has(name.toLowerCase())) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is a reserved SQL keyword`);
  }
  return name;
}
function isIdent(name) {
  return IDENT.test(name) && !name.toLowerCase().startsWith(RESERVED_PREFIX);
}
function quoteIdent(name) {
  assertIdent(name, "field");
  return `"${name.replaceAll('"', '""')}"`;
}
function quoteChecked(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new IdentError(`refusing to quote unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

// src/interpolate.ts
var ENV_TOKEN = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;
function interpolateEnv(source, env = process.env) {
  return source.replace(ENV_TOKEN, (match, name, fallback) => {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new SchemaError(`missing environment variable ${name} referenced from app.yaml`, { match });
  });
}

// src/policies.ts
var OWNER = /^owner\(([A-Za-z_][A-Za-z0-9_]*)\)$/;
var ROLE = /^role\(([A-Za-z0-9_-]+)\)$/;
function parsePolicy(expr) {
  const trimmed = expr.trim();
  switch (trimmed) {
    case "public":
      return { kind: "public" };
    case "authenticated":
      return { kind: "authenticated" };
    case "admin":
      return { kind: "admin" };
    default: {
      const owner = OWNER.exec(trimmed);
      if (owner?.[1]) {
        return { kind: "owner", field: owner[1] };
      }
      const role = ROLE.exec(trimmed);
      if (role?.[1]) {
        return { kind: "role", role: role[1] };
      }
      throw new SchemaError(invalidPolicyMessage(expr));
    }
  }
}
function invalidPolicyMessage(expr, where) {
  const expected = "Expected public, authenticated, admin, owner(field), or role(name).";
  if (where) {
    return `app.yaml: invalid policy ${JSON.stringify(expr)} on ${where}. ${expected}`;
  }
  return `app.yaml: invalid policy ${JSON.stringify(expr)}. ${expected}`;
}
function parsePolicies(value, fallback, where) {
  if (value === undefined) {
    return fallback;
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    try {
      return parsePolicy(item);
    } catch (error) {
      if (where && error instanceof SchemaError) {
        throw new SchemaError(invalidPolicyMessage(item, where));
      }
      throw error;
    }
  });
}
function policyRequiresAuth(policies) {
  return policies.every((policy) => policy.kind !== "public");
}
function describePolicy(policy) {
  switch (policy.kind) {
    case "public":
      return "public";
    case "authenticated":
      return "authenticated";
    case "admin":
      return "admin";
    case "owner":
      return `owner(${policy.field})`;
    case "role":
      return `role(${policy.role})`;
    default: {
      const _never = policy;
      return _never;
    }
  }
}

// src/topo.ts
function topologicalLayers(entities) {
  const names = new Set(entities.map((entity) => entity.name));
  const incoming = new Map;
  for (const entity of entities) {
    incoming.set(entity.name, new Set);
  }
  for (const entity of entities) {
    for (const field of entity.fields) {
      const target = field.relation?.to;
      if (!target || target === entity.name) {
        continue;
      }
      if (!names.has(target)) {
        throw new SchemaError(`entity ${entity.name} field ${field.name} relates to unknown entity ${target}`);
      }
      if (field.relation?.many) {
        continue;
      }
      incoming.get(entity.name)?.add(target);
    }
  }
  const layers = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => (incoming.get(name)?.size ?? 0) === 0);
    if (ready.length === 0) {
      throw new SchemaError("circular relation detected among entities", { remaining: [...remaining] });
    }
    ready.sort();
    layers.push(ready);
    for (const name of ready) {
      remaining.delete(name);
      for (const deps of incoming.values()) {
        deps.delete(name);
      }
    }
  }
  return layers;
}
function topologicalOrder(entities) {
  return topologicalLayers(entities).flat();
}

// src/format-schema.ts
import { ZodError } from "zod";

// src/yaml-schema.ts
import { z } from "zod";
var ident = z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a letter/underscore followed by letters, digits, or underscores");
var policyExpr = z.string().min(1);
var policyValue = z.union([policyExpr, z.array(policyExpr).min(1)]);
var FIELD_TYPES = [
  "text",
  "email",
  "password",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "enum",
  "file",
  "relation"
];
var APP_YAML_TOP_LEVEL_KEYS = ["app", "branding", "runtime", "auth", "entities", "webhooks", "mail", "jobs"];
var fieldType = z.enum(FIELD_TYPES);
var fieldObject = z.object({
  type: fieldType,
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  index: z.boolean().optional(),
  default: z.unknown().optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  to: ident.optional(),
  onDelete: z.enum(["restrict", "cascade", "set_null"]).optional(),
  many: z.boolean().optional(),
  renameFrom: ident.optional(),
  secret: z.boolean().optional(),
  description: z.string().optional(),
  writable: z.enum(["admin", "none"]).optional(),
  readonly: z.boolean().optional(),
  adminOnly: z.boolean().optional(),
  private: z.boolean().optional()
}).strict();
var fieldValue = z.union([fieldType, fieldObject]);
var RATE_WINDOW_PATTERN = /^([1-9][0-9]{0,5})(s|m|h|d)$/;
var rateLimitRule = z.object({
  limit: z.number().int().min(1).max(1e6),
  window: z.union([
    z.string().regex(RATE_WINDOW_PATTERN, "must be a window like 30s, 10m, 1h, or 1d"),
    z.number().int().min(1).max(7 * 24 * 60 * 60)
  ]),
  per: z.enum(["ip", "user"]).optional()
}).strict();
var entityRateLimit = z.object({
  read: rateLimitRule.optional(),
  create: rateLimitRule.optional(),
  update: rateLimitRule.optional(),
  delete: rateLimitRule.optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "add at least one of read, create, update, or delete" });
var entityAdmin = z.object({
  group: z.string().trim().min(1).max(40).optional(),
  order: z.number().int().min(-1000).max(1000).optional(),
  icon: z.string().trim().min(1).refine((value) => [...value].length <= 2, { message: "use 1 or 2 characters, like PO or a single emoji" }).optional(),
  hidden: z.boolean().optional()
}).strict();
var entityObject = z.object({
  label: z.string().optional(),
  plural: z.string().optional(),
  display: ident.optional(),
  description: z.string().optional(),
  auth: z.boolean().optional(),
  renameFrom: ident.optional(),
  fields: z.record(ident, fieldValue),
  indexes: z.array(z.union([ident, z.array(ident).min(1)])).optional(),
  policies: z.object({
    read: policyValue.optional(),
    create: policyValue.optional(),
    update: policyValue.optional(),
    delete: policyValue.optional()
  }).strict().optional(),
  rateLimit: entityRateLimit.optional(),
  realtime: z.union([z.boolean(), z.enum(["full", "ids"])]).optional(),
  admin: entityAdmin.optional()
}).strict();
var webhookObject = z.object({
  entity: z.union([ident, z.literal("*")]),
  events: z.array(z.enum(["create", "update", "delete"])).min(1),
  url: z.string().min(1),
  secret: z.string().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(100).max(120000).optional()
}).strict();
var mailAddressList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
var mailScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
var mailCondition = z.union([
  mailScalar,
  z.object({
    equals: mailScalar.optional(),
    not: mailScalar.optional(),
    in: z.array(mailScalar).min(1).optional(),
    notIn: z.array(mailScalar).min(1).optional(),
    exists: z.boolean().optional()
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: "use one of equals, not, in, notIn, or exists"
  })
]);
var mailRuleObject = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "must be letters, digits, dashes, or underscores").optional(),
  entity: ident,
  events: z.array(z.enum(["create", "update", "delete"])).min(1),
  to: mailAddressList,
  cc: mailAddressList.optional(),
  bcc: mailAddressList.optional(),
  replyTo: z.string().min(1).optional(),
  subject: z.string().min(1).max(500).optional(),
  template: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "must be a file name like receipt or order-shipped"),
  when: z.record(ident, mailCondition).optional(),
  changed: z.array(ident).min(1).optional(),
  expand: z.array(ident).min(1).optional(),
  maxAttempts: z.number().int().min(1).max(100).optional()
}).strict();
var hexColor = z.string({
  error: (issue) => issue.input === undefined ? undefined : 'must be a quoted hex color like "#0f766e" (without quotes, # starts a YAML comment)'
}).regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #0f766e or #0a7");
function brandingFile(kind, extensions) {
  const pattern = new RegExp(`^(?:\\./)?branding/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.(?:${extensions.join("|")})$`, "i");
  return z.string().regex(pattern, `must be a file in the branding/ folder, like branding/${kind}.${extensions[0]} (${extensions.join(", ")})`);
}
var brandingObject = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  logo: brandingFile("logo", ["svg", "png", "jpg", "jpeg", "webp"]).optional(),
  favicon: brandingFile("favicon", ["svg", "png", "ico"]).optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "add at least one of name, primaryColor, accentColor, logo, or favicon, or remove branding"
});
var jobItem = z.object({
  name: ident,
  cron: z.string().min(1),
  handler: ident.optional(),
  timezone: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  enabled: z.boolean().optional()
}).strict();
var appYamlSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional()
  }).strict(),
  branding: brandingObject.optional(),
  runtime: z.object({
    dialect: z.enum(["sqlite", "postgres"]).optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    sqlite: z.object({
      path: z.string().min(1)
    }).strict().optional(),
    postgres: z.object({
      url: z.string().min(1)
    }).strict().optional(),
    jwt: z.object({
      secret: z.string().min(1).optional(),
      accessTtlSeconds: z.number().int().positive().optional(),
      refreshTtlSeconds: z.number().int().positive().optional()
    }).strict().optional(),
    files: z.object({
      driver: z.enum(["local", "s3"]).optional(),
      path: z.string().optional(),
      bucket: z.string().optional(),
      endpoint: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      region: z.string().optional(),
      virtualHostedStyle: z.boolean().optional(),
      pathStyle: z.boolean().optional(),
      maxBytes: z.number().int().positive().optional(),
      allowedMimeTypes: z.array(z.string().min(1)).optional(),
      signedUrlTtlSeconds: z.number().int().positive().optional(),
      rateLimit: rateLimitRule.optional()
    }).strict().optional(),
    backups: z.object({
      interval: z.string().optional(),
      cron: z.string().optional(),
      retain: z.number().int().positive().optional(),
      destination: z.string().optional()
    }).strict().optional(),
    alerts: z.object({
      email: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
      webhook: z.string().min(1).optional(),
      backupMaxAgeHours: z.number().positive().optional(),
      checkIntervalMinutes: z.number().int().min(1).max(1440).optional()
    }).strict().optional(),
    cors: z.object({
      origins: z.array(z.string()).optional()
    }).strict().optional(),
    hooks: z.string().optional(),
    apiDocs: z.enum(["public", "admin"]).optional(),
    realtime: z.object({
      broker: z.enum(["auto", "memory", "postgres"]).optional(),
      maxConnections: z.number().int().min(1).max(1e6).optional(),
      maxPerUser: z.number().int().min(1).max(1e4).optional(),
      heartbeatSeconds: z.number().int().min(1).max(300).optional(),
      replayEvents: z.number().int().min(0).max(1e5).optional(),
      retainMinutes: z.number().int().min(1).max(10080).optional(),
      maxBufferKb: z.number().int().min(1).max(65536).optional()
    }).strict().optional(),
    mcp: z.union([
      z.boolean(),
      z.object({
        enabled: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(50).optional()
      }).strict()
    ]).optional(),
    trustProxy: z.union([z.boolean(), z.number().int().min(0).max(10), z.array(z.string().min(1)).min(1)]).optional(),
    webhooks: z.object({
      retainDays: z.number().int().min(1).max(3650).optional()
    }).strict().optional(),
    mail: z.object({
      retainDays: z.number().int().min(1).max(3650).optional()
    }).strict().optional(),
    jobs: z.object({
      retainDays: z.number().int().min(1).max(3650).optional()
    }).strict().optional()
  }).strict().optional(),
  auth: z.object({
    entity: ident.optional(),
    identity: ident.optional(),
    password: ident.optional(),
    role: ident.optional(),
    adminRole: z.string().optional(),
    requireVerifiedEmail: z.boolean().optional(),
    signup: z.enum(["open", "invite", "closed"]).optional()
  }).strict().optional(),
  entities: z.record(ident, entityObject).refine((value) => Object.keys(value).length > 0, {
    message: "at least one entity is required"
  }),
  webhooks: z.array(webhookObject).optional(),
  mail: z.array(mailRuleObject).optional(),
  jobs: z.array(jobItem).optional()
}).strict();

// src/format-schema.ts
var IDENT2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
var TOP_LEVEL = new Set(APP_YAML_TOP_LEVEL_KEYS);
var FIELD_TYPE_SET = new Set(FIELD_TYPES);
function isAppYamlValidationError(error) {
  return error instanceof SchemaError || error instanceof ZodError;
}
function formatAppYamlError(error) {
  if (error instanceof ZodError) {
    return formatZodError(error);
  }
  if (error instanceof SchemaError) {
    return prefixLines(error.message);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function formatZodError(error) {
  const lines = flattenZodIssues(error).map(formatIssue).flat();
  const unique = [...new Set(lines.filter((line) => line.length > 0))];
  return unique.length > 0 ? unique.join(`
`) : "app.yaml: schema is invalid";
}
function prefixLines(message) {
  return message.split(`
`).map((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      return trimmed;
    }
    return trimmed.startsWith("app.yaml:") ? trimmed : `app.yaml: ${trimmed}`;
  }).join(`
`);
}
function flattenZodIssues(error) {
  const out = [];
  for (const issue of error.issues) {
    out.push(...flattenIssue(issue, []));
  }
  return out;
}
function flattenIssue(issue, prefix) {
  const path = [...prefix, ...issue.path];
  if (issue.code === "invalid_union") {
    const children = issue.errors.flatMap((branch) => branch.flatMap((child) => flattenIssue(child, path)));
    return preferUsefulIssues(children, path);
  }
  if (issue.code === "invalid_key") {
    return issue.issues.flatMap((child) => flattenIssue(child, path));
  }
  if (issue.code === "invalid_element") {
    return issue.issues.flatMap((child) => flattenIssue(child, [...path, issue.key]));
  }
  return [{ ...issue, path }];
}
function preferUsefulIssues(issues, path) {
  const ranked = issues.filter((issue) => issue.code === "unrecognized_keys" || issue.code === "invalid_value" && (issue.input === null || typeof issue.input !== "object") || issue.code === "invalid_format" && issue.path.length >= path.length);
  if (ranked.length > 0) {
    return ranked;
  }
  const deepest = issues.reduce((best, issue) => !best || issue.path.length > best.path.length ? issue : best, undefined);
  return deepest ? [deepest] : [];
}
function looksLikeEntityName(key) {
  return IDENT2.test(key) && !TOP_LEVEL.has(key);
}
function pathLabel(path) {
  return path.map(String).join(".");
}
function isFieldTypeIssue(issue) {
  if (issue.code !== "invalid_value") {
    return false;
  }
  const options = issue.values.map(String);
  return options.every((option) => FIELD_TYPE_SET.has(option)) && FIELD_TYPES.every((type) => options.includes(type));
}
function formatIssue(issue) {
  const path = pathLabel(issue.path);
  const at = path.length > 0 ? ` at ${path}` : "";
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((key) => {
        if (key === "renamedFrom" || key === "renamed_from" || key === "rename_from") {
          return `app.yaml: unknown key "${key}"${at}. Did you mean renameFrom?`;
        }
        if (issue.path.length === 0 && looksLikeEntityName(key)) {
          return `app.yaml: unknown top-level key "${key}". Did you mean to put it under "entities:"?`;
        }
        if (issue.path[0] === "entities" && issue.path.length === 2) {
          return `app.yaml: unknown key "${key}" on entity ${String(issue.path[1])}${hintEntityKeys()}`;
        }
        return `app.yaml: unknown key "${key}"${at}`;
      });
    case "invalid_value": {
      if (isFieldTypeIssue(issue)) {
        return [
          `app.yaml: unknown field type ${JSON.stringify(issue.input)}${at}. Valid types: ${FIELD_TYPES.join(", ")}`
        ];
      }
      return [`app.yaml: invalid value ${JSON.stringify(issue.input)}${at}. Expected ${issue.values.map(String).join(", ")}`];
    }
    case "invalid_type": {
      if (issue.input === undefined) {
        if (issue.path.length === 1 && issue.path[0] === "entities") {
          return [`app.yaml: missing "entities". At least one entity is required.`];
        }
        if (issue.path.length === 1 && issue.path[0] === "app") {
          return [`app.yaml: missing "app" (needs app.name).`];
        }
        return [`app.yaml: missing "${path}"`];
      }
      if (issue.path[0] === "branding" && /Color$/.test(String(issue.path[1] ?? ""))) {
        return [`app.yaml: ${path} ${issue.message}`];
      }
      return [`app.yaml: ${path || "root"} should be ${issue.expected}, not ${receivedType(issue.input)}`];
    }
    case "too_small":
      if (issue.path.length === 1 && issue.path[0] === "entities") {
        return [`app.yaml: missing "entities". At least one entity is required.`];
      }
      return [`app.yaml: ${path || "value"} is too small`];
    case "custom":
      return [`app.yaml: ${issue.message}${at}`];
    default:
      return [`app.yaml: ${issue.message}${at}`];
  }
}
function receivedType(input) {
  if (input === null)
    return "null";
  if (Array.isArray(input))
    return "array";
  return typeof input;
}
function hintEntityKeys() {
  return ". Valid keys are label, plural, display, description, auth, renameFrom, fields, indexes, policies, rateLimit.";
}

// src/compile-auth.ts
function findAuthEntity(yaml, entities) {
  const marked = entities.filter((entity) => entity.auth);
  const configured = yaml.auth?.entity;
  let entity;
  if (configured) {
    entity = entities.find((item) => item.name === configured);
    if (!entity) {
      throw new SchemaError(`auth.entity ${configured} does not exist`);
    }
  } else if (marked.length === 1) {
    entity = marked[0];
  } else if (marked.length > 1) {
    throw new SchemaError("multiple entities have auth: true; set auth.entity explicitly");
  } else {
    entity = entities.find((item) => item.name === "users");
  }
  if (!entity) {
    throw new SchemaError("an auth entity is required; mark one entity with auth: true");
  }
  entity.auth = true;
  const identityField = yaml.auth?.identity ?? "email";
  const passwordField = yaml.auth?.password ?? "password";
  const roleField = yaml.auth?.role ?? "role";
  if (!entity.fieldMap[identityField]) {
    throw new SchemaError(`auth identity field ${entity.name}.${identityField} is missing`);
  }
  if (!entity.fieldMap[passwordField] || entity.fieldMap[passwordField]?.type !== "password") {
    throw new SchemaError(`auth password field ${entity.name}.${passwordField} must have type password`);
  }
  if (!entity.fieldMap[roleField] || entity.fieldMap[roleField]?.type !== "enum") {
    throw new SchemaError(`auth role field ${entity.name}.${roleField} must be an enum`);
  }
  const adminRole = yaml.auth?.adminRole ?? "admin";
  if (!entity.fieldMap[roleField]?.enumValues?.includes(adminRole)) {
    throw new SchemaError(`auth adminRole ${adminRole} is not in ${entity.name}.${roleField} values`);
  }
  entity.fieldMap[identityField].unique = true;
  entity.fieldMap[identityField].required = true;
  entity.fieldMap[passwordField].required = true;
  entity.fieldMap[passwordField].secret = true;
  entity.fieldMap[roleField].writable = "admin";
  ensureEmailVerifiedField(entity);
  markPrivateAuthFields(entity, [identityField, roleField, "emailVerified"]);
  return {
    entity: entity.name,
    identityField,
    passwordField,
    roleField,
    adminRole,
    requireVerifiedEmail: yaml.auth?.requireVerifiedEmail === true,
    signup: compileSignup(yaml, entity)
  };
}
function compileSignup(yaml, entity) {
  const publicCreate = entity.policies.create.some((policy) => policy.kind === "public");
  const mode = yaml.auth?.signup ?? (publicCreate ? "open" : "invite");
  if (mode !== "open" && publicCreate) {
    throw new SchemaError(`${entity.name}.policies.create is public, which lets anyone sign up through POST /api/v1/${entity.name}, but auth.signup is ${mode}. ` + "Set auth.signup: open to allow public signup, and use admin for the create policy.");
  }
  return mode;
}
function markPrivateAuthFields(entity, names) {
  for (const name of names) {
    const field = entity.fieldMap[name];
    if (field && field.private === undefined) {
      field.private = true;
    }
  }
}
function ensureEmailVerifiedField(entity) {
  const existing = entity.fieldMap.emailVerified;
  if (existing) {
    if (existing.type !== "boolean") {
      throw new SchemaError(`${entity.name}.emailVerified must be boolean`);
    }
    if (existing.writable === "any") {
      existing.writable = "admin";
    }
    return;
  }
  const field = {
    name: "emailVerified",
    type: "boolean",
    required: false,
    unique: false,
    indexed: false,
    defaultValue: false,
    secret: false,
    writable: "admin",
    description: "True after the user confirms their email, or when an admin marks them verified."
  };
  entity.fields.push(field);
  entity.fieldMap.emailVerified = field;
}

// src/compile-entity.ts
var SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);
function asFieldObject(value) {
  if (typeof value === "string") {
    return { type: value };
  }
  return value;
}
function compileField(entityName, name, raw) {
  assertIdent(name, "field");
  if (SYSTEM_FIELDS.has(name)) {
    throw new SchemaError(`${entityName}.${name} is a reserved system field`);
  }
  const type = raw.type;
  if (type === "enum" && (!raw.values || raw.values.length === 0)) {
    throw new SchemaError(`${entityName}.${name} is an enum and needs a values list`);
  }
  if (type === "relation" && !raw.to) {
    throw new SchemaError(`${entityName}.${name} is a relation and needs to: <entity>`);
  }
  if (raw.to && type !== "relation") {
    throw new SchemaError(`${entityName}.${name} has to: but is not a relation`);
  }
  if (raw.many !== undefined && type !== "relation") {
    throw new SchemaError(`${entityName}.${name} has many: but is not a relation`);
  }
  if (raw.many === true) {
    if (raw.unique === true || raw.index === true) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation and cannot be unique or indexed (its join table is indexed already)`);
    }
    if (raw.default !== undefined) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation and cannot have a default`);
    }
    if (raw.onDelete !== undefined) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation: links are always removed when either record is deleted, so leave out onDelete`);
    }
  }
  if (raw.values && type !== "enum") {
    throw new SchemaError(`${entityName}.${name} has values: but is not an enum`);
  }
  for (const value of raw.values ?? []) {
    assertIdent(value, "enum");
  }
  return {
    name,
    type,
    required: raw.required === true || raw.default !== undefined ? raw.required !== false : false,
    unique: raw.unique === true,
    indexed: raw.index === true || raw.unique === true || type === "relation" && raw.many !== true,
    defaultValue: raw.default,
    enumValues: raw.values,
    relation: raw.to ? {
      to: raw.to,
      onDelete: raw.onDelete ?? "restrict",
      ...raw.many === true ? { many: true } : {}
    } : undefined,
    renameFrom: raw.renameFrom,
    secret: raw.secret === true || type === "password",
    description: raw.description,
    writable: compileWritable(entityName, name, raw),
    ...raw.private !== undefined ? { private: raw.private } : {}
  };
}
function compileWritable(entityName, name, raw) {
  const flags = [raw.writable, raw.readonly === true ? "none" : undefined, raw.adminOnly === true ? "admin" : undefined].filter((value) => value === "admin" || value === "none");
  const unique = [...new Set(flags)];
  if (unique.length > 1) {
    throw new SchemaError(`${entityName}.${name} has conflicting writable/readonly/adminOnly flags`);
  }
  return unique[0] ?? "any";
}
function systemFields() {
  return [
    {
      name: "id",
      type: "text",
      required: true,
      unique: true,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    },
    {
      name: "createdAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    },
    {
      name: "updatedAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    }
  ];
}
function defaultPolicies(auth) {
  if (auth) {
    return {
      read: [{ kind: "owner", field: "id" }, { kind: "admin" }],
      create: [{ kind: "admin" }],
      update: [{ kind: "owner", field: "id" }],
      delete: [{ kind: "admin" }]
    };
  }
  return {
    read: [{ kind: "authenticated" }],
    create: [{ kind: "authenticated" }],
    update: [{ kind: "authenticated" }],
    delete: [{ kind: "authenticated" }]
  };
}
function resolveDisplay(entityName, fields, requested) {
  if (requested) {
    const field = fields.find((item) => item.name === requested);
    if (!field) {
      throw new SchemaError(`${entityName} display field ${requested} does not exist`);
    }
    if (field.secret) {
      throw new SchemaError(`${entityName} display field ${requested} cannot be secret`);
    }
    return requested;
  }
  for (const name of ["name", "title", "email", "company"]) {
    const field = fields.find((item) => item.name === name && !item.secret);
    if (field) {
      return name;
    }
  }
  return "id";
}
function titleCase(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function pluralize(name) {
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1 && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}
var RESERVED_ENTITY_NAMES = ["auth", "audit", "backups", "docs", "files", "jobs", "mail", "realtime", "status", "webhooks", "_meta"];
function assertEntityRouteFree(name) {
  if (RESERVED_ENTITY_NAMES.includes(name.toLowerCase())) {
    throw new SchemaError(`entity name "${name}" is reserved because /api/v1/${name.toLowerCase()} is a built in route. Rename the entity, for example to "${name}_items" or a more specific name.`);
  }
}
function compileIndexes(entityName, fieldMap, raw) {
  if (!raw) {
    return [];
  }
  return raw.map((item) => {
    const fields = Array.isArray(item) ? item : [item];
    for (const field of fields) {
      if (!fieldMap[field]) {
        throw new SchemaError(`${entityName} index references missing field ${field}`);
      }
    }
    return fields;
  });
}
var WINDOW_UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };
function rateWindowSeconds(window) {
  if (typeof window === "number") {
    return window;
  }
  const match = RATE_WINDOW_PATTERN.exec(window);
  if (!match) {
    throw new SchemaError(`rate limit window ${JSON.stringify(window)} must look like 30s, 10m, 1h, or 1d`);
  }
  const seconds = Number(match[1]) * WINDOW_UNIT_SECONDS[match[2]];
  if (seconds > 7 * 86400) {
    throw new SchemaError(`rate limit window ${window} is longer than 7 days`);
  }
  return seconds;
}
function compileRateLimit(raw) {
  return { limit: raw.limit, windowSeconds: rateWindowSeconds(raw.window), per: raw.per ?? "ip" };
}
function compileEntityRateLimit(raw) {
  const out = {};
  for (const action of ["read", "create", "update", "delete"]) {
    const rule = raw[action];
    if (rule) {
      out[action] = compileRateLimit(rule);
    }
  }
  return out;
}

// src/cron.ts
class CronError extends Error {
  constructor(message) {
    super(message);
    this.name = "CronError";
  }
}
var MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
var WEEKDAYS = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};
var RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 7 }
};
var DOW_FROM_NAME = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};
function parseCron(source) {
  const trimmed = source.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`Cron expression must have 5 fields (minute hour day month weekday), got ${parts.length}.`);
  }
  const [minuteSrc, hourSrc, daySrc, monthSrc, dowSrc] = parts;
  const minute = parseField(minuteSrc, "minute");
  const hour = parseField(hourSrc, "hour");
  const day = parseField(daySrc, "day");
  const month = parseField(monthSrc, "month");
  const dowRaw = parseField(dowSrc, "dow");
  const dow = new Set;
  for (const value of dowRaw) {
    dow.add(value === 7 ? 0 : value);
  }
  return {
    source: trimmed,
    minute,
    hour,
    day,
    month,
    dow,
    dayRestricted: daySrc !== "*",
    dowRestricted: dowSrc !== "*"
  };
}
function parseField(src, field) {
  const { min, max } = RANGES[field];
  const out = new Set;
  for (const item of src.split(",")) {
    if (!item) {
      throw new CronError(`Empty item in ${field} field.`);
    }
    const slash = item.indexOf("/");
    const rangePart = slash === -1 ? item : item.slice(0, slash);
    const stepPart = slash === -1 ? undefined : item.slice(slash + 1);
    const step = stepPart === undefined ? 1 : parseIntStrict(stepPart, field);
    if (step <= 0) {
      throw new CronError(`Step in ${field} must be a positive integer.`);
    }
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const bits = rangePart.split("-");
      if (bits.length !== 2 || !bits[0] || !bits[1]) {
        throw new CronError(`Invalid range "${item}" in ${field}.`);
      }
      start = parseNameOrNumber(bits[0], field);
      end = parseNameOrNumber(bits[1], field);
      if (start > end) {
        throw new CronError(`Range start is after end in ${field}: "${item}".`);
      }
    } else {
      start = parseNameOrNumber(rangePart, field);
      end = start;
    }
    if (start < min || end > max) {
      const sunday = field === "dow" ? ", or 7 for Sunday" : "";
      throw new CronError(`Value out of range in ${field}: "${item}" (allowed ${min}-${max}${sunday}).`);
    }
    for (let n = start;n <= end; n += step) {
      out.add(n);
    }
  }
  if (out.size === 0) {
    throw new CronError(`No values produced for ${field} field "${src}".`);
  }
  return out;
}
function parseIntStrict(raw, field) {
  if (!/^\d+$/.test(raw)) {
    throw new CronError(`Invalid number "${raw}" in ${field}.`);
  }
  return Number(raw);
}
function parseNameOrNumber(raw, field) {
  const key = raw.toLowerCase();
  if (field === "month" && key in MONTHS) {
    return MONTHS[key];
  }
  if (field === "dow" && key in WEEKDAYS) {
    return WEEKDAYS[key];
  }
  return parseIntStrict(raw, field);
}
function isValidTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dow: DOW_FROM_NAME[map.weekday.slice(0, 3).toLowerCase()] ?? 0
  };
}
function zonedToUtc(timeZone, year, month, day, hour, minute, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = zonedParts(new Date(guess), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const instant = new Date(guess + (guess - asUtc));
  const check = zonedParts(instant, timeZone);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute || check.second !== second) {
    return null;
  }
  return instant;
}
function matchesCron(expr, date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return matchesParts(expr, parts);
}
function matchesParts(expr, parts) {
  if (!expr.minute.has(parts.minute) || !expr.hour.has(parts.hour) || !expr.month.has(parts.month)) {
    return false;
  }
  const dayOk = expr.day.has(parts.day);
  const dowOk = expr.dow.has(parts.dow);
  if (expr.dayRestricted && expr.dowRestricted) {
    return dayOk || dowOk;
  }
  if (expr.dayRestricted) {
    return dayOk;
  }
  if (expr.dowRestricted) {
    return dowOk;
  }
  return true;
}
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function weekdayOf(timeZone, year, month, day) {
  const at = zonedToUtc(timeZone, year, month, day, 12, 0) ?? zonedToUtc(timeZone, year, month, day, 3, 0) ?? zonedToUtc(timeZone, year, month, day, 0, 0);
  return at ? zonedParts(at, timeZone).dow : null;
}
function dayMatches(expr, timeZone, year, month, day) {
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) {
    return false;
  }
  const dow = weekdayOf(timeZone, year, month, day);
  const dayOk = !expr.dayRestricted || expr.day.has(day);
  const dowOk = !expr.dowRestricted || dow !== null && expr.dow.has(dow);
  if (expr.dayRestricted && expr.dowRestricted) {
    return dayOk || dowOk;
  }
  return dayOk && dowOk;
}
function normalizeDate(year, month, day) {
  if (month > 12) {
    month -= 12;
    year += 1;
  }
  if (month < 1) {
    month += 12;
    year -= 1;
  }
  if (year < 1970 || year > 2100) {
    return null;
  }
  return { year, month, day };
}
function nextCronOccurrence(expr, from, timeZone, horizonMs = 4 * 365 * 24 * 60 * 60 * 1000) {
  const parts = zonedParts(from, timeZone);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let hour = parts.hour;
  let minute = parts.minute + 1;
  let guard = 0;
  while (guard++ < 50000) {
    while (minute > 59) {
      minute -= 60;
      hour += 1;
    }
    while (hour > 23) {
      hour -= 24;
      day += 1;
    }
    while (day > daysInMonth(year, month)) {
      day -= daysInMonth(year, month);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const normalized = normalizeDate(year, month, day);
    if (!normalized) {
      return null;
    }
    year = normalized.year;
    month = normalized.month;
    day = normalized.day;
    const candidate = zonedToUtc(timeZone, year, month, day, hour, minute);
    if (candidate && candidate.getTime() - from.getTime() > horizonMs) {
      return null;
    }
    if (!expr.month.has(month)) {
      month += 1;
      day = 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!dayMatches(expr, timeZone, year, month, day)) {
      day += 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!expr.hour.has(hour)) {
      const nextHour = nextInSet(expr.hour, hour + 1, 23) ?? null;
      if (nextHour === null) {
        day += 1;
        hour = 0;
        minute = 0;
      } else {
        hour = nextHour;
        minute = 0;
      }
      continue;
    }
    if (!expr.minute.has(minute)) {
      const nextMinute = nextInSet(expr.minute, minute, 59);
      if (nextMinute === null) {
        hour += 1;
        minute = 0;
      } else {
        minute = nextMinute;
      }
      continue;
    }
    if (!candidate) {
      minute += 1;
      continue;
    }
    return candidate;
  }
  return null;
}
function latestCronOccurrenceAtOrBefore(expr, at, timeZone, horizonMs = 4 * 365 * 24 * 60 * 60 * 1000) {
  const parts = zonedParts(at, timeZone);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let hour = parts.hour;
  let minute = parts.minute;
  let guard = 0;
  while (guard++ < 50000) {
    while (minute < 0) {
      minute += 60;
      hour -= 1;
    }
    while (hour < 0) {
      hour += 24;
      day -= 1;
    }
    while (day < 1) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day += daysInMonth(year, month);
    }
    const normalized = normalizeDate(year, month, day);
    if (!normalized) {
      return null;
    }
    year = normalized.year;
    month = normalized.month;
    day = normalized.day;
    const candidate = zonedToUtc(timeZone, year, month, day, hour, minute);
    if (candidate && at.getTime() - candidate.getTime() > horizonMs) {
      return null;
    }
    if (!expr.month.has(month)) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = daysInMonth(year, month);
      hour = 23;
      minute = 59;
      continue;
    }
    if (!dayMatches(expr, timeZone, year, month, day)) {
      day -= 1;
      hour = 23;
      minute = 59;
      continue;
    }
    if (!expr.hour.has(hour)) {
      const prevHour = prevInSet(expr.hour, hour - 1, 0);
      if (prevHour === null) {
        day -= 1;
        hour = 23;
        minute = 59;
      } else {
        hour = prevHour;
        minute = 59;
      }
      continue;
    }
    if (!expr.minute.has(minute)) {
      const prevMinute = prevInSet(expr.minute, minute, 0);
      if (prevMinute === null) {
        hour -= 1;
        minute = 59;
      } else {
        minute = prevMinute;
      }
      continue;
    }
    if (!candidate) {
      minute -= 1;
      continue;
    }
    if (candidate.getTime() > at.getTime()) {
      minute -= 1;
      continue;
    }
    return candidate;
  }
  return null;
}
function nextInSet(set, current, max) {
  for (let n = current;n <= max; n++) {
    if (set.has(n)) {
      return n;
    }
  }
  return null;
}
function prevInSet(set, current, min) {
  for (let n = current;n >= min; n--) {
    if (set.has(n)) {
      return n;
    }
  }
  return null;
}

// src/compile-jobs.ts
function compileJobs(doc) {
  const raw = doc.jobs ?? [];
  const jobs = [];
  const seen = new Set;
  raw.forEach((item, index) => {
    const label = item.name ? `job "${item.name}"` : `job #${index + 1}`;
    const name = (item.name ?? "").trim();
    if (!isIdent(name)) {
      throw new SchemaError(`${label}: name must be a letter or underscore, then letters, digits, or underscores`);
    }
    if (seen.has(name)) {
      throw new SchemaError(`${label}: duplicate job name`);
    }
    seen.add(name);
    const handlerRaw = (item.handler ?? "").trim();
    const handler = handlerRaw || name;
    if (!isIdent(handler)) {
      throw new SchemaError(`${label}: handler must be a letter or underscore, then letters, digits, or underscores`);
    }
    const cronSrc = (item.cron ?? "").trim();
    if (!cronSrc) {
      throw new SchemaError(`${label}: cron is required`);
    }
    try {
      parseCron(cronSrc);
    } catch (error) {
      const message = error instanceof CronError ? error.message : String(error);
      throw new SchemaError(`${label}: ${message}`);
    }
    const timezone = (item.timezone ?? "UTC").trim() || "UTC";
    if (!isValidTimeZone(timezone)) {
      throw new SchemaError(`${label}: timezone ${JSON.stringify(timezone)} is not a valid IANA time zone`);
    }
    const timeoutSeconds = item.timeoutSeconds ?? JOB_DEFAULT_TIMEOUT_SECONDS;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) {
      throw new SchemaError(`${label}: timeoutSeconds must be an integer from 1 to 86400`);
    }
    jobs.push({
      name,
      cron: cronSrc,
      handler,
      timezone,
      dryRun: item.dryRun ?? false,
      timeoutSeconds,
      enabled: item.enabled ?? true
    });
  });
  return jobs;
}

// src/compile-mail.ts
var MAIL_TEMPLATE_TOKEN = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
var MAIL_ROOTS = new Set(["record", "before", "expand", "event", "app"]);
function listOf(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
function checkMailPlaceholders(label, value, expand, entity) {
  for (const match of value.matchAll(MAIL_TEMPLATE_TOKEN)) {
    const path = (match[1] ?? "").trim();
    if (match[0].startsWith("{{{")) {
      throw new SchemaError(`${label}: raw {{{ }}} output is not allowed here, use {{ ${path} }}`);
    }
    if (path.startsWith("#") || path.startsWith("/") || path === "else") {
      throw new SchemaError(`${label}: blocks like {{#if}} are only allowed in template files`);
    }
    const parts = path.split(".");
    const root = parts[0] ?? "";
    if (!MAIL_ROOTS.has(root)) {
      throw new SchemaError(`${label}: {{ ${path} }} must start with record, before, expand, event, or app`);
    }
    if ((root === "record" || root === "before") && parts[1] && !entity.fieldMap[parts[1]]) {
      throw new SchemaError(`${label}: {{ ${path} }} references unknown field ${entity.name}.${parts[1]}`);
    }
    if (root === "expand" && parts[1] && !expand.includes(parts[1])) {
      throw new SchemaError(`${label}: {{ ${path} }} needs "${parts[1]}" in the rule's expand list`);
    }
  }
}
function compileMailRules(yaml, entityMap) {
  const seen = new Set;
  return (yaml.mail ?? []).map((rule, index) => {
    const id = rule.name ?? `mail_${index + 1}`;
    const label = `mail rule ${rule.name ? `"${rule.name}"` : `#${index + 1}`}`;
    if (seen.has(id)) {
      throw new SchemaError(`${label}: name ${id} is used by more than one mail rule`);
    }
    seen.add(id);
    const entity = entityMap[rule.entity];
    if (!entity) {
      const known = Object.keys(entityMap).join(", ");
      throw new SchemaError(`${label}: entity ${rule.entity} does not exist (known entities: ${known})`);
    }
    const expand = rule.expand ?? [];
    for (const name of expand) {
      const field = entity.fieldMap[name];
      if (!field) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} does not exist`);
      }
      if (!field.relation) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} must be a relation field`);
      }
    }
    const changed = rule.changed ?? [];
    for (const name of changed) {
      if (!entity.fieldMap[name]) {
        throw new SchemaError(`${label}: changed field ${entity.name}.${name} does not exist`);
      }
    }
    if (changed.length > 0 && (rule.events.length !== 1 || rule.events[0] !== "update")) {
      throw new SchemaError(`${label}: changed only works with events: [update]`);
    }
    const when = [];
    for (const [field, condition] of Object.entries(rule.when ?? {})) {
      const target = entity.fieldMap[field];
      if (!target) {
        throw new SchemaError(`${label}: when field ${entity.name}.${field} does not exist`);
      }
      if (target.secret || target.type === "password") {
        throw new SchemaError(`${label}: when cannot test secret field ${entity.name}.${field}`);
      }
      if (condition === null || typeof condition !== "object") {
        when.push({ field, op: "equals", value: condition });
        continue;
      }
      const ops = Object.keys(condition);
      if (ops.length !== 1) {
        throw new SchemaError(`${label}: when.${field} must use exactly one of equals, not, in, notIn, or exists`);
      }
      if (condition.in) {
        when.push({ field, op: "in", values: condition.in });
      } else if (condition.notIn) {
        when.push({ field, op: "notIn", values: condition.notIn });
      } else if (condition.exists !== undefined) {
        when.push({ field, op: "exists", exists: condition.exists });
      } else if ("not" in condition) {
        when.push({ field, op: "not", value: condition.not ?? null });
      } else {
        when.push({ field, op: "equals", value: condition.equals ?? null });
      }
    }
    const to = listOf(rule.to);
    const cc = listOf(rule.cc);
    const bcc = listOf(rule.bcc);
    for (const [key, values] of [["to", to], ["cc", cc], ["bcc", bcc]]) {
      for (const value of values) {
        checkMailPlaceholders(`${label} ${key}`, value, expand, entity);
      }
    }
    if (rule.replyTo) {
      checkMailPlaceholders(`${label} replyTo`, rule.replyTo, expand, entity);
    }
    if (rule.subject) {
      checkMailPlaceholders(`${label} subject`, rule.subject, expand, entity);
    }
    return {
      id,
      entity: entity.name,
      events: rule.events,
      to,
      cc,
      bcc,
      replyTo: rule.replyTo,
      subject: rule.subject,
      template: rule.template,
      when,
      changed,
      expand,
      maxAttempts: rule.maxAttempts ?? MAIL_DEFAULT_MAX_ATTEMPTS
    };
  });
}

// src/compile-secrets.ts
var DEV_JWT_SECRET = "dev-only-change-me";
var MIN_JWT_SECRET_LENGTH = 32;
var PLACEHOLDER_SECRET = /change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|dev[-_ ]?only|example|placeholder/i;
function isDevMode(env) {
  const mode = (env.BAKORIN_ENV ?? "").trim().toLowerCase();
  if (mode === "production") {
    return false;
  }
  return mode === "development" || mode === "dev" || mode === "test" || env.BAKORIN_TEST === "1";
}
function weakJwtSecretReason(secret) {
  if (!secret) {
    return "it is not set";
  }
  if (secret === DEV_JWT_SECRET || PLACEHOLDER_SECRET.test(secret)) {
    return "it is a placeholder value";
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `it is ${secret.length} characters; use at least ${MIN_JWT_SECRET_LENGTH}`;
  }
  if (new Set(secret).size < 10) {
    return "it repeats too few characters to be random";
  }
  return null;
}
function assertStrongJwtSecret(secret, name = "JWT_SECRET") {
  const reason = weakJwtSecretReason(secret);
  if (reason) {
    throw new SchemaError(`${name} is too weak for production: ${reason}. Generate one with: openssl rand -base64 48. ` + "Only `bakorin dev` (BAKORIN_ENV=development) runs without a strong secret.");
  }
}

// src/compile-runtime.ts
function parseIntervalHours(value) {
  if (!value) {
    return null;
  }
  const match = /^(\d+)(h|d)?$/.exec(value.trim());
  if (!match?.[1]) {
    throw new SchemaError(`invalid backup interval ${JSON.stringify(value)}; use e.g. 24h or 7d`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "h";
  return unit === "d" ? amount * 24 : amount;
}
function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return;
}
function joinPosix(base, child) {
  if (child.startsWith("/") || /^[A-Za-z]:[\\/]/.test(child)) {
    return child;
  }
  return `${base.replace(/[/\\]+$/, "")}/${child.replace(/^[/\\]+/, "")}`;
}
function parsePort(runtimePort, env) {
  const raw = firstEnv(env, ["PORT"]) ?? (runtimePort !== undefined ? String(runtimePort) : undefined);
  const port = raw ? Number(raw) : 4371;
  return Number.isFinite(port) && port > 0 ? port : 4371;
}
function parseVirtualHostedStyle(files, env) {
  const addressing = (firstEnv(env, ["S3_ADDRESSING_STYLE"]) ?? "").toLowerCase();
  if (addressing === "path") {
    return false;
  }
  if (addressing === "virtual" || addressing === "virtual-hosted" || addressing === "virtualhosted") {
    return true;
  }
  const pathStyle = (firstEnv(env, ["S3_FORCE_PATH_STYLE", "S3_PATH_STYLE"]) ?? "").toLowerCase();
  if (pathStyle === "true" || pathStyle === "1" || pathStyle === "yes") {
    return false;
  }
  if (pathStyle === "false" || pathStyle === "0" || pathStyle === "no") {
    return true;
  }
  const virtual = (firstEnv(env, ["S3_VIRTUAL_HOSTED_STYLE"]) ?? "").toLowerCase();
  if (virtual === "true" || virtual === "1" || virtual === "yes") {
    return true;
  }
  if (virtual === "false" || virtual === "0" || virtual === "no") {
    return false;
  }
  if (files?.pathStyle === true) {
    return false;
  }
  if (files?.virtualHostedStyle === true) {
    return true;
  }
  return false;
}
function compileRuntime(yaml, production, env) {
  const runtime = yaml.runtime ?? {};
  const dialect = runtime.dialect ?? (runtime.postgres?.url ? "postgres" : "sqlite");
  const jwtSecret = runtime.jwt?.secret || env.JWT_SECRET || (production ? "" : DEV_JWT_SECRET);
  const jwtSecretPrevious = firstEnv(env, ["JWT_SECRET_PREVIOUS"]);
  if (production) {
    assertStrongJwtSecret(jwtSecret);
    if (jwtSecretPrevious) {
      assertStrongJwtSecret(jwtSecretPrevious, "JWT_SECRET_PREVIOUS");
    }
  }
  if (dialect === "postgres" && !runtime.postgres?.url) {
    throw new SchemaError("runtime.postgres.url is required when dialect is postgres");
  }
  const dataDir = firstEnv(env, ["BAKORIN_DATA_DIR"]);
  const bucket = runtime.files?.bucket ?? firstEnv(env, ["S3_BUCKET", "BUCKET"]);
  const endpoint = runtime.files?.endpoint ?? firstEnv(env, ["S3_ENDPOINT", "AWS_ENDPOINT_URL", "AWS_ENDPOINT"]);
  const accessKey = runtime.files?.accessKey ?? firstEnv(env, ["S3_ACCESS_KEY", "AWS_ACCESS_KEY_ID"]);
  const secretKey = runtime.files?.secretKey ?? firstEnv(env, ["S3_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"]);
  const region = runtime.files?.region ?? firstEnv(env, ["S3_REGION", "AWS_DEFAULT_REGION", "AWS_REGION"]) ?? "auto";
  const filesDriverEnv = firstEnv(env, ["FILES_DRIVER", "BAKORIN_FILES_DRIVER"]);
  const driver = filesDriverEnv === "local" || filesDriverEnv === "s3" ? filesDriverEnv : bucket ? "s3" : runtime.files?.driver ?? "local";
  const yamlSqlite = runtime.sqlite?.path ?? "./data/app.db";
  const sqliteFile = yamlSqlite.split(/[/\\]/).pop() ?? "app.db";
  const sqlitePath = dataDir ? joinPosix(dataDir, sqliteFile) : yamlSqlite;
  const yamlFilesPath = runtime.files?.path ?? "./data/uploads";
  const filesPath = driver === "local" && dataDir ? joinPosix(dataDir, "uploads") : yamlFilesPath;
  const yamlDest = runtime.backups?.destination;
  const backupPrefix = firstEnv(env, ["BAKORIN_BACKUP_PREFIX"]) ?? "backups";
  const destination = firstEnv(env, ["BAKORIN_BACKUP_DESTINATION"]) ?? (yamlDest?.startsWith("s3://") ? yamlDest : undefined) ?? (bucket ? `s3://${bucket}/${backupPrefix}` : undefined) ?? (dataDir ? joinPosix(dataDir, "backups") : undefined) ?? yamlDest ?? "./data/backups";
  return {
    dialect,
    host: runtime.host ?? "0.0.0.0",
    port: parsePort(runtime.port, env),
    sqlitePath,
    postgresUrl: runtime.postgres?.url,
    jwtSecret,
    jwtSecretPrevious,
    accessTtlSeconds: runtime.jwt?.accessTtlSeconds ?? 900,
    refreshTtlSeconds: runtime.jwt?.refreshTtlSeconds ?? 60 * 60 * 24 * 30,
    files: {
      driver,
      path: filesPath,
      bucket,
      endpoint,
      accessKey,
      secretKey,
      region,
      virtualHostedStyle: parseVirtualHostedStyle(runtime.files, env),
      maxBytes: runtime.files?.maxBytes ?? 10 * 1024 * 1024,
      allowedMimeTypes: parseAllowedMime(runtime.files?.allowedMimeTypes),
      signedUrlTtlSeconds: runtime.files?.signedUrlTtlSeconds ?? 900,
      ...runtime.files?.rateLimit ? { rateLimit: compileRateLimit(runtime.files.rateLimit) } : {}
    },
    backups: {
      intervalHours: parseIntervalHours(runtime.backups?.interval),
      cron: runtime.backups?.cron,
      retain: runtime.backups?.retain ?? 14,
      destination
    },
    corsOrigins: parseCorsOrigins(runtime.cors?.origins, env),
    hooksPath: runtime.hooks,
    apiDocs: parseApiDocs(runtime.apiDocs, env, production),
    appUrl: parseAppUrl(env, parsePort(runtime.port, env)),
    webhooksRetainDays: parseWebhookRetainDays(runtime.webhooks?.retainDays, env),
    mailRetainDays: parseMailRetainDays(runtime.mail?.retainDays, env),
    jobsRetainDays: parseJobsRetainDays(runtime.jobs?.retainDays, env),
    alerts: parseAlerts(runtime.alerts, env),
    trustProxy: parseTrustProxy(runtime.trustProxy, env),
    realtime: parseRealtime(runtime.realtime, env, dialect),
    mcp: parseMcp(runtime.mcp, env)
  };
}
function envInt(env, name, min, max) {
  const raw = (env[name] ?? "").trim();
  if (!raw) {
    return;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SchemaError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}
function parseRealtime(raw, env, dialect) {
  const brokerEnv = (env.BAKORIN_REALTIME_BROKER ?? "").trim().toLowerCase();
  if (brokerEnv && brokerEnv !== "auto" && brokerEnv !== "memory" && brokerEnv !== "postgres") {
    throw new SchemaError(`BAKORIN_REALTIME_BROKER must be auto, memory, or postgres, not ${JSON.stringify(env.BAKORIN_REALTIME_BROKER)}`);
  }
  const broker = brokerEnv || raw?.broker || REALTIME_DEFAULTS.broker;
  if (broker === "postgres" && dialect !== "postgres") {
    throw new SchemaError("runtime.realtime.broker postgres needs runtime.dialect postgres");
  }
  return {
    broker,
    maxConnections: envInt(env, "BAKORIN_REALTIME_MAX_CONNECTIONS", 1, 1e6) ?? raw?.maxConnections ?? REALTIME_DEFAULTS.maxConnections,
    maxPerUser: envInt(env, "BAKORIN_REALTIME_MAX_PER_USER", 1, 1e4) ?? raw?.maxPerUser ?? REALTIME_DEFAULTS.maxPerUser,
    heartbeatSeconds: raw?.heartbeatSeconds ?? REALTIME_DEFAULTS.heartbeatSeconds,
    replayEvents: raw?.replayEvents ?? REALTIME_DEFAULTS.replayEvents,
    retainMinutes: raw?.retainMinutes ?? REALTIME_DEFAULTS.retainMinutes,
    maxBufferKb: raw?.maxBufferKb ?? REALTIME_DEFAULTS.maxBufferKb
  };
}
function parseMcp(raw, env) {
  const fromYaml = typeof raw === "boolean" ? { enabled: raw } : raw ?? {};
  const flag = (env.BAKORIN_MCP ?? "").trim().toLowerCase();
  let enabled = fromYaml.enabled ?? MCP_DEFAULTS.enabled;
  if (flag === "true" || flag === "1") {
    enabled = true;
  } else if (flag === "false" || flag === "0") {
    enabled = false;
  } else if (flag) {
    throw new SchemaError(`BAKORIN_MCP must be true or false, not ${JSON.stringify(env.BAKORIN_MCP)}`);
  }
  return { enabled, sampleLimit: fromYaml.sampleLimit ?? MCP_DEFAULTS.sampleLimit };
}
function parseTrustProxy(yaml, env) {
  const raw = (env.TRUST_PROXY ?? "").trim();
  let value = yaml;
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower === "false" || lower === "no" || lower === "off") {
      value = false;
    } else if (lower === "true" || lower === "yes" || lower === "on") {
      value = true;
    } else if (/^\d+$/.test(raw)) {
      value = Number(raw);
    } else {
      value = raw.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (value === undefined || value === false || value === 0) {
    return { kind: "none" };
  }
  if (value === true) {
    return { kind: "hops", hops: 1 };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new SchemaError("runtime.trustProxy hop count must be a whole number from 0 to 10");
    }
    return { kind: "hops", hops: value };
  }
  for (const cidr of value) {
    if (!isCidr(cidr)) {
      throw new SchemaError(`runtime.trustProxy: ${cidr} is not an IP address or CIDR range`);
    }
  }
  return { kind: "cidrs", cidrs: value };
}
function isCidr(value) {
  const [address, bits, extra] = value.split("/");
  if (extra !== undefined || !address) {
    return false;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    if (v4.slice(1).some((part) => Number(part) > 255)) {
      return false;
    }
    return bits === undefined || /^\d+$/.test(bits) && Number(bits) <= 32;
  }
  if (address.includes(":") && /^[0-9a-fA-F:.]+$/.test(address)) {
    return bits === undefined || /^\d+$/.test(bits) && Number(bits) <= 128;
  }
  return false;
}
function parseAlerts(yaml, env) {
  const emailSource = yaml?.email ?? env.BAKORIN_ALERT_EMAIL;
  const email = (Array.isArray(emailSource) ? emailSource : (emailSource ?? "").split(",")).map((value) => value.trim()).filter(Boolean);
  for (const address of email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new SchemaError(`runtime.alerts.email: ${address} is not an email address`);
    }
  }
  const webhook = (yaml?.webhook ?? env.BAKORIN_ALERT_WEBHOOK ?? "").trim() || undefined;
  if (webhook && !/^https?:\/\//.test(webhook)) {
    throw new SchemaError("runtime.alerts.webhook must be an http(s) URL");
  }
  const envMaxAge = env.BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS ? Number(env.BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS) : undefined;
  const maxAge = yaml?.backupMaxAgeHours ?? (envMaxAge && Number.isFinite(envMaxAge) && envMaxAge > 0 ? envMaxAge : undefined);
  return {
    email,
    ...webhook ? { webhook } : {},
    backupMaxAgeHours: maxAge ?? null,
    checkIntervalMinutes: yaml?.checkIntervalMinutes ?? 15
  };
}
function parseWebhookRetainDays(yamlValue, env) {
  const fromEnv = firstEnv(env, ["BAKORIN_WEBHOOK_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : yamlValue ?? WEBHOOK_DEFAULT_RETAIN_DAYS;
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.webhooks.retainDays must be an integer from 1 to 3650");
  }
  return value;
}
function parseMailRetainDays(yamlValue, env) {
  const fromEnv = firstEnv(env, ["BAKORIN_MAIL_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : yamlValue ?? MAIL_DEFAULT_RETAIN_DAYS;
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.mail.retainDays must be an integer from 1 to 3650");
  }
  return value;
}
function parseJobsRetainDays(yamlValue, env) {
  const fromEnv = firstEnv(env, ["BAKORIN_JOBS_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : yamlValue ?? JOB_DEFAULT_RETAIN_DAYS;
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.jobs.retainDays must be an integer from 1 to 3650");
  }
  return value;
}
function parseCorsOrigins(yamlOrigins, env) {
  const fromEnv = firstEnv(env, ["CORS_ORIGINS"]);
  if (fromEnv !== undefined) {
    const list = fromEnv.split(",").map((item) => item.trim()).filter(Boolean);
    if (list.length === 0) {
      throw new SchemaError("CORS_ORIGINS is empty");
    }
    return list;
  }
  return yamlOrigins ?? ["*"];
}
function parseAppUrl(env, port) {
  const raw = firstEnv(env, ["APP_URL", "BAKORIN_APP_URL"]) ?? `http://127.0.0.1:${port}`;
  return raw.replace(/\/+$/, "");
}
var DEFAULT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain"
];
function parseAllowedMime(raw) {
  if (!raw || raw.length === 0) {
    return [...DEFAULT_ALLOWED_MIME_TYPES];
  }
  if (raw.includes("*")) {
    return ["*"];
  }
  return raw;
}
function parseApiDocs(value, env, production) {
  const fromEnv = (env.BAKORIN_API_DOCS ?? "").trim().toLowerCase();
  if (fromEnv === "public" || fromEnv === "admin") {
    return fromEnv;
  }
  if (fromEnv) {
    throw new SchemaError(`BAKORIN_API_DOCS must be public or admin, not ${JSON.stringify(env.BAKORIN_API_DOCS)}`);
  }
  return value ?? (production ? "admin" : "public");
}
// src/compile-serialize.ts
var REDACTED = "[redacted]";
function redactUrl(value) {
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = REDACTED;
    }
    url.search = "";
    return url.toString();
  } catch {
    return REDACTED;
  }
}
function redactRuntime(runtime) {
  return {
    ...runtime,
    jwtSecret: REDACTED,
    ...runtime.jwtSecretPrevious ? { jwtSecretPrevious: REDACTED } : {},
    ...runtime.postgresUrl ? { postgresUrl: redactUrl(runtime.postgresUrl) } : {},
    files: {
      ...runtime.files,
      ...runtime.files.accessKey ? { accessKey: REDACTED } : {},
      ...runtime.files.secretKey ? { secretKey: REDACTED } : {}
    },
    ...runtime.alerts ? { alerts: { ...runtime.alerts, ...runtime.alerts.webhook ? { webhook: redactUrl(runtime.alerts.webhook) } : {} } } : {}
  };
}
function serializeAst(ast) {
  return JSON.stringify({
    version: ast.version,
    appName: ast.appName,
    appVersion: ast.appVersion,
    appDescription: ast.appDescription,
    branding: ast.branding,
    runtime: redactRuntime(ast.runtime),
    entities: ast.entities,
    order: ast.order,
    auth: ast.auth,
    webhooks: ast.webhooks,
    mail: ast.mail
  });
}
function deserializeAst(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.version !== SCHEMA_AST_VERSION) {
    throw new SchemaError(`unsupported schema AST version ${String(parsed.version)}`);
  }
  parsed.entityMap = Object.fromEntries(parsed.entities.map((entity) => [entity.name, entity]));
  for (const entity of parsed.entities) {
    entity.fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    if (!entity.display) {
      entity.display = "id";
    }
    if (!entity.indexes) {
      entity.indexes = [];
    }
    for (const field of entity.fields) {
      if (!field.writable) {
        field.writable = SYSTEM_FIELDS.has(field.name) ? "none" : "any";
      }
    }
  }
  if (!parsed.auth.requireVerifiedEmail) {
    parsed.auth.requireVerifiedEmail = false;
  }
  if (!parsed.auth.signup) {
    parsed.auth.signup = "invite";
  }
  if (!parsed.runtime.trustProxy) {
    parsed.runtime.trustProxy = { kind: "none" };
  }
  if (!parsed.runtime.apiDocs) {
    parsed.runtime.apiDocs = "admin";
  }
  parsed.runtime.realtime = { ...REALTIME_DEFAULTS, ...parsed.runtime.realtime ?? {} };
  parsed.runtime.mcp = { ...MCP_DEFAULTS, ...parsed.runtime.mcp ?? {} };
  if (!parsed.runtime.appUrl) {
    parsed.runtime.appUrl = `http://127.0.0.1:${parsed.runtime.port}`;
  }
  if (!parsed.runtime.files.maxBytes) {
    parsed.runtime.files.maxBytes = 10 * 1024 * 1024;
  }
  if (!parsed.runtime.files.allowedMimeTypes || parsed.runtime.files.allowedMimeTypes.length === 0) {
    parsed.runtime.files.allowedMimeTypes = [...DEFAULT_ALLOWED_MIME_TYPES];
  }
  if (!parsed.runtime.files.signedUrlTtlSeconds) {
    parsed.runtime.files.signedUrlTtlSeconds = 900;
  }
  if (!parsed.runtime.webhooksRetainDays) {
    parsed.runtime.webhooksRetainDays = WEBHOOK_DEFAULT_RETAIN_DAYS;
  }
  if (!parsed.runtime.mailRetainDays) {
    parsed.runtime.mailRetainDays = MAIL_DEFAULT_RETAIN_DAYS;
  }
  parsed.mail = parsed.mail ?? [];
  parsed.jobs = parsed.jobs ?? [];
  if (parsed.runtime && parsed.runtime.jobsRetainDays === undefined) {
    parsed.runtime.jobsRetainDays = 30;
  }
  for (const hook of parsed.webhooks ?? []) {
    hook.maxAttempts = hook.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS;
    hook.timeoutMs = hook.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

// src/compile.ts
function compileAppYaml(source, options = {}) {
  const env = options.env ?? process.env;
  const interpolated = interpolateEnv(source, env);
  let parsed;
  try {
    parsed = parseYaml(interpolated);
  } catch (error) {
    throw new SchemaError(`app.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsedYaml = appYamlSchema.safeParse(parsed, { reportInput: true });
  if (!parsedYaml.success) {
    throw new SchemaError(formatZodError(parsedYaml.error));
  }
  const yaml = parsedYaml.data;
  const production = options.production ?? !isDevMode(env);
  const runtime = compileRuntime(yaml, production, env);
  const entities = Object.entries(yaml.entities).map(([name, raw]) => {
    assertIdent(name, "entity");
    assertEntityRouteFree(name);
    const compiledFields = Object.entries(raw.fields).map(([fieldName, fieldRaw]) => compileField(name, fieldName, asFieldObject(fieldRaw)));
    const fields = [...systemFields(), ...compiledFields];
    const fieldMap = Object.fromEntries(fields.map((field) => [field.name, field]));
    const fallback = defaultPolicies(raw.auth === true || name === yaml.auth?.entity);
    const policies = {
      read: parsePolicies(raw.policies?.read, fallback.read, `entities.${name}.policies.read`),
      create: parsePolicies(raw.policies?.create, fallback.create, `entities.${name}.policies.create`),
      update: parsePolicies(raw.policies?.update, fallback.update, `entities.${name}.policies.update`),
      delete: parsePolicies(raw.policies?.delete, fallback.delete, `entities.${name}.policies.delete`)
    };
    for (const action of ["read", "create", "update", "delete"]) {
      for (const policy of policies[action]) {
        if (policy.kind === "owner" && !fieldMap[policy.field]) {
          throw new SchemaError(`${name} policy ${action}: owner(${policy.field}) references a missing field`);
        }
      }
    }
    return {
      name,
      label: raw.label ?? titleCase(name.replace(/s$/, "") || name),
      plural: raw.plural ?? titleCase(pluralize(name)),
      display: resolveDisplay(name, fields, raw.display),
      description: raw.description,
      auth: raw.auth === true,
      fields,
      fieldMap,
      policies,
      indexes: compileIndexes(name, fieldMap, raw.indexes),
      deprecated: false,
      ...raw.renameFrom ? { renameFrom: raw.renameFrom } : {},
      ...raw.rateLimit ? { rateLimit: compileEntityRateLimit(raw.rateLimit) } : {},
      ...raw.realtime === true || raw.realtime === "full" ? { realtime: "full" } : {},
      ...raw.realtime === "ids" ? { realtime: "ids" } : {},
      ...raw.admin && Object.keys(raw.admin).length > 0 ? { admin: { ...raw.admin } } : {}
    };
  });
  const entityMap = Object.fromEntries(entities.map((entity) => [entity.name, entity]));
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (field.relation && !entityMap[field.relation.to]) {
        throw new SchemaError(`${entity.name}.${field.name} relates to unknown entity ${field.relation.to}`);
      }
    }
  }
  const auth = findAuthEntity(yaml, entities);
  const order = topologicalOrder(entities);
  const webhooks = (yaml.webhooks ?? []).map((hook, index) => {
    if (hook.entity !== "*" && !entityMap[hook.entity]) {
      throw new SchemaError(`webhook entity ${hook.entity} does not exist`);
    }
    return {
      id: `wh_${index + 1}`,
      entity: hook.entity,
      events: hook.events,
      url: hook.url,
      secret: hook.secret,
      maxAttempts: hook.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS,
      timeoutMs: hook.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS
    };
  });
  const mail = compileMailRules(yaml, entityMap);
  const jobs = compileJobs(yaml);
  return {
    version: SCHEMA_AST_VERSION,
    appName: yaml.app.name,
    appVersion: yaml.app.version ?? "0.1.0",
    appDescription: yaml.app.description,
    ...yaml.branding ? { branding: compileBranding(yaml.branding) } : {},
    runtime,
    entities,
    entityMap,
    order,
    auth,
    webhooks,
    mail,
    jobs
  };
}
// src/diff.ts
var WIDENING = {
  text: ["text", "email"],
  email: ["email", "text"],
  password: ["password"],
  number: ["number"],
  integer: ["integer", "number"],
  boolean: ["boolean"],
  date: ["date", "datetime"],
  datetime: ["datetime"],
  enum: ["enum"],
  file: ["file"],
  relation: ["relation"]
};
function fieldMapByRename(entity) {
  const map = new Map;
  for (const field of entity.fields) {
    map.set(field.name, field);
    if (field.renameFrom) {
      map.set(field.renameFrom, field);
    }
  }
  return map;
}
function isAdditiveField(field) {
  return !field.required || field.defaultValue !== undefined || field.name === "id";
}
function typeCompatible(from, to) {
  if (from.type !== to.type) {
    return (WIDENING[from.type] ?? []).includes(to.type);
  }
  if (from.type === "relation") {
    return from.relation?.to === to.relation?.to;
  }
  if (from.type === "enum") {
    const oldValues = new Set(from.enumValues ?? []);
    return (to.enumValues ?? []).every((value) => oldValues.has(value)) ? true : (from.enumValues ?? []).every((value) => (to.enumValues ?? []).includes(value));
  }
  return true;
}
function diffSchemas(from, to) {
  const plan = { auto: [], safe: [], deprecate: [], abort: [] };
  if (!from) {
    for (const name of to.order) {
      const entity = to.entityMap[name];
      if (entity) {
        plan.auto.push({ tier: "auto", kind: "add_entity", entity });
      }
    }
    return plan;
  }
  const fromEntities = new Map(from.entities.map((entity) => [entity.name, entity]));
  const toEntities = new Map(to.entities.map((entity) => [entity.name, entity]));
  const consumedFrom = new Set;
  for (const next of to.entities) {
    let prev = fromEntities.get(next.name);
    if (!prev && next.renameFrom) {
      const old = fromEntities.get(next.renameFrom);
      if (old && !toEntities.has(old.name) && !consumedFrom.has(old.name)) {
        plan.safe.push({ tier: "safe", kind: "rename_entity", from: old.name, to: next.name });
        prev = old;
      }
    }
    if (!prev) {
      plan.auto.push({ tier: "auto", kind: "add_entity", entity: next });
      continue;
    }
    consumedFrom.add(prev.name);
    diffEntity(prev, next, plan);
  }
  for (const prev of from.entities) {
    if (!consumedFrom.has(prev.name) && !toEntities.has(prev.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_entity", entity: prev.name });
    }
  }
  addRenameHints(plan);
  return plan;
}
function addRenameHints(plan) {
  for (const change of plan.deprecate) {
    if (change.kind !== "drop_field") {
      continue;
    }
    const added = plan.auto.find((item) => item.kind === "add_field" && item.entity === change.entity);
    if (added && added.kind === "add_field") {
      change.hint = `if ${change.entity}.${added.field.name} is ${change.field} renamed, add renameFrom: ${change.field} to it instead`;
    }
  }
  for (const change of plan.deprecate) {
    if (change.kind !== "drop_entity") {
      continue;
    }
    const added = plan.auto.find((item) => item.kind === "add_entity");
    if (added && added.kind === "add_entity") {
      change.hint = `if ${added.entity.name} is ${change.entity} renamed, add renameFrom: ${change.entity} to the entity instead`;
    }
  }
}
function describeChange(change) {
  switch (change.kind) {
    case "add_entity":
      return `add entity ${change.entity.name}`;
    case "add_field":
      return `add field ${change.entity}.${change.field.name} (${change.field.type}${change.field.relation?.many ? ", many" : ""})`;
    case "add_index":
      return `add index on ${change.entity} (${change.fields.join(", ")})`;
    case "rename_entity":
      return `rename entity ${change.from} to ${change.to}`;
    case "rename_field":
      return `rename field ${change.entity}.${change.from} to ${change.entity}.${change.to}`;
    case "drop_entity":
      return `remove entity ${change.entity} (the table stays in the database but the API stops serving it)`;
    case "drop_field":
      return `remove field ${change.entity}.${change.field} (the column stays in the database but the API stops serving it)`;
    case "remove_enum_values":
      return `remove enum values ${change.values.join(", ")} from ${change.entity}.${change.field} (existing rows keep them)`;
    case "breaking":
      return change.message;
    default: {
      const _never = change;
      return String(_never);
    }
  }
}
function needsConfirmation(plan) {
  return plan.deprecate.length > 0;
}
function touchesExistingData(plan) {
  return plan.safe.length > 0 || plan.deprecate.length > 0;
}
function destructiveCode(plan) {
  const text = plan.deprecate.map((change) => describeChange(change)).sort().join(`
`);
  let hash = 2166136261;
  for (let i = 0;i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function formatPlan(plan) {
  const lines = [];
  const section = (title, changes) => {
    if (changes.length === 0) {
      return;
    }
    lines.push(title);
    for (const change of changes) {
      lines.push(`  - ${describeChange(change)}`);
      const hint = change.hint;
      if (hint) {
        lines.push(`    hint: ${hint}`);
      }
    }
  };
  section("Additive, applied automatically:", plan.auto);
  section("Renames declared with renameFrom, applied automatically after a backup:", plan.safe);
  section("Removals, need confirmation:", plan.deprecate);
  section("Blocked, cannot be applied without losing data:", plan.abort);
  if (lines.length === 0) {
    lines.push("No schema changes.");
  }
  return lines.join(`
`);
}
function diffEntity(prev, next, plan) {
  const prevFields = new Map(prev.fields.map((field) => [field.name, field]));
  const matchedPrev = new Set;
  const nextByRename = fieldMapByRename(next);
  for (const field of next.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      const existing = prevFields.get(field.name);
      if (existing) {
        matchedPrev.add(field.name);
      }
      continue;
    }
    let oldField = prevFields.get(field.name);
    if (!oldField && field.renameFrom) {
      oldField = prevFields.get(field.renameFrom);
      if (oldField) {
        plan.safe.push({
          tier: "safe",
          kind: "rename_field",
          entity: next.name,
          from: oldField.name,
          to: field.name
        });
        matchedPrev.add(oldField.name);
        compareField(next.name, oldField, field, plan);
        continue;
      }
      plan.abort.push({
        tier: "abort",
        kind: "breaking",
        message: `${next.name}.${field.name} renameFrom ${field.renameFrom} does not exist on the current schema`
      });
      continue;
    }
    if (!oldField) {
      if (!isAdditiveField(field)) {
        plan.abort.push({
          tier: "abort",
          kind: "breaking",
          message: `cannot add required field ${next.name}.${field.name} without a default`
        });
        continue;
      }
      plan.auto.push({ tier: "auto", kind: "add_field", entity: next.name, field });
      continue;
    }
    matchedPrev.add(oldField.name);
    compareField(next.name, oldField, field, plan);
  }
  for (const oldField of prev.fields) {
    if (oldField.name === "id" || oldField.name === "createdAt" || oldField.name === "updatedAt") {
      continue;
    }
    if (!matchedPrev.has(oldField.name) && !nextByRename.has(oldField.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_field", entity: next.name, field: oldField.name });
    }
  }
  const prevKeys = new Set((prev.indexes ?? []).map((fields) => fields.join(",")));
  for (const fields of next.indexes ?? []) {
    const key = fields.join(",");
    if (!prevKeys.has(key)) {
      plan.auto.push({ tier: "auto", kind: "add_index", entity: next.name, fields });
    }
  }
}
function compareField(entity, from, to, plan) {
  if (from.type !== to.type && !typeCompatible(from, to)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot change ${entity}.${from.name} from ${from.type} to ${to.type}. Add a new field, copy the data in a hook or script, then remove the old one`
    });
    return;
  }
  if (from.type === "relation" && to.type === "relation" && Boolean(from.relation?.many) !== Boolean(to.relation?.many)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot switch ${entity}.${from.name} between a single relation and many: true. Add a new field, copy the links in a script, then remove the old one`
    });
    return;
  }
  if (from.type === "relation" && to.type === "relation" && from.relation?.to !== to.relation?.to) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot retarget relation ${entity}.${from.name} from ${from.relation?.to} to ${to.relation?.to}`
    });
  }
  if (from.type === "enum" && to.type === "enum") {
    const removed = (from.enumValues ?? []).filter((value) => !(to.enumValues ?? []).includes(value));
    if (removed.length > 0) {
      plan.deprecate.push({ tier: "deprecate", kind: "remove_enum_values", entity, field: to.name, values: removed });
    }
  }
  if (!from.unique && to.unique) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot add unique to existing field ${entity}.${from.name} (may fail on existing rows)`
    });
  }
  if (!from.required && to.required && to.defaultValue === undefined) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot make ${entity}.${from.name} required without a default`
    });
  }
  if (!from.indexed && to.indexed) {
    plan.auto.push({ tier: "auto", kind: "add_index", entity, fields: [to.name] });
  }
}
function assertPlanApplyable(plan) {
  if (plan.abort.length > 0) {
    const messages = plan.abort.map((change) => change.kind === "breaking" ? change.message : change.kind);
    throw new DiffAbortError(`schema changes abort because they are breaking:
- ${messages.join(`
- `)}`, messages);
  }
}
// src/typegen.ts
function tsType(field) {
  switch (field.type) {
    case "text":
    case "email":
    case "password":
    case "date":
    case "datetime":
    case "file":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return (field.enumValues ?? []).map((value) => JSON.stringify(value)).join(" | ") || "string";
    case "relation":
      return field.relation?.many ? "string[]" : "string";
    default: {
      const _never = field.type;
      return _never;
    }
  }
}
function pascal(name) {
  return name.replace(/(^[a-z])|([-_][a-z])/g, (chunk) => chunk.replace(/[-_]/, "").toUpperCase());
}
function fieldLine(field) {
  if (field.secret) {
    return `  // ${field.name} is write-only and never returned`;
  }
  const optional = field.required || field.relation?.many ? "" : "?";
  return `  ${field.name}${optional}: ${tsType(field)};`;
}
function entityInterface(entity) {
  const lines = entity.fields.filter((field) => !field.secret).map(fieldLine);
  const writes = entity.fields.filter((field) => field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt").map((field) => {
    const optional = field.required && field.defaultValue === undefined ? "" : "?";
    return `  ${field.name}${optional}: ${tsType(field)};`;
  });
  const name = pascal(entity.name);
  return `export interface ${name} {
${lines.join(`
`)}
}

export interface ${name}Write {
${writes.join(`
`)}
}
`;
}
function generateTypes(ast) {
  const interfaces = ast.entities.map(entityInterface).join(`
`);
  const mapLines = ast.entities.map((entity) => `  ${entity.name}: ${pascal(entity.name)};`).join(`
`);
  const writeMap = ast.entities.map((entity) => `  ${entity.name}: ${pascal(entity.name)}Write;`).join(`
`);
  return `/* Generated by bakorin. Do not edit. */

${interfaces}
export interface BakorinEntities {
${mapLines}
}

export interface BakorinWrites {
${writeMap}
}

export type BakorinEntityName = keyof BakorinEntities;
${schemaConst(ast)}`;
}
var SYSTEM_FIELDS2 = new Set(["id", "createdAt", "updatedAt"]);
function ownerFieldNames(entity, authEntity) {
  const names = new Set;
  for (const rules of Object.values(entity.policies)) {
    for (const rule of rules) {
      if (rule.kind === "owner" && rule.field !== "id") {
        names.add(rule.field);
      }
    }
  }
  for (const field of entity.fields) {
    if (field.relation?.to === authEntity && !entity.auth) {
      names.add(field.name);
    }
  }
  return names;
}
function schemaConst(ast) {
  const entities = {};
  for (const entity of ast.entities) {
    const owners = ownerFieldNames(entity, ast.auth.entity);
    entities[entity.name] = {
      name: entity.name,
      display: entity.display,
      fields: entity.fields.map((field) => {
        const out = { name: field.name, type: field.type };
        if (field.required)
          out.required = true;
        if (field.enumValues)
          out.enumValues = field.enumValues;
        if (field.relation)
          out.relation = field.relation.many ? { to: field.relation.to, many: true } : { to: field.relation.to };
        if (field.writable !== "any")
          out.writable = field.writable;
        if (field.secret)
          out.secret = true;
        if (field.private)
          out.private = true;
        if (owners.has(field.name))
          out.owner = true;
        if (SYSTEM_FIELDS2.has(field.name))
          out.system = true;
        if (field.description)
          out.description = field.description;
        if (field.defaultValue !== undefined && !field.secret)
          out.defaultValue = field.defaultValue;
        return out;
      })
    };
  }
  const value = {
    entities,
    auth: { entity: ast.auth.entity, identityField: ast.auth.identityField, passwordField: ast.auth.passwordField }
  };
  return `
/** Field names, types, and rules for UI helpers like RecordForm in @bakorin/sdk. */
export const bakorinSchema = ${JSON.stringify(value, null, 2)} as const;
`;
}
// src/schema-graph.ts
function buildSchemaGraph(ast) {
  const layers = topologicalLayers(ast.entities);
  const entities = ast.entities.map((entity) => ({
    name: entity.name,
    label: entity.label,
    plural: entity.plural,
    display: entity.display,
    description: entity.description,
    auth: entity.auth,
    fields: entity.fields.map((field) => ({
      name: field.name,
      type: field.type,
      displayType: field.secret ? "hidden" : field.type,
      required: field.required,
      unique: field.unique,
      secret: field.secret,
      description: field.description,
      relation: field.relation ? { to: field.relation.to, onDelete: field.relation.onDelete, ...field.relation.many ? { many: true } : {} } : undefined
    })),
    indexes: entity.indexes,
    policies: {
      read: entity.policies.read.map(describePolicy),
      create: entity.policies.create.map(describePolicy),
      update: entity.policies.update.map(describePolicy),
      delete: entity.policies.delete.map(describePolicy)
    }
  }));
  const relations = [];
  for (const entity of ast.entities) {
    for (const field of entity.fields) {
      if (!field.relation) {
        continue;
      }
      relations.push({
        from: entity.name,
        field: field.name,
        to: field.relation.to,
        onDelete: field.relation.onDelete,
        ...field.relation.many ? { many: true } : {}
      });
    }
  }
  return {
    app: { name: ast.appName, version: ast.appVersion },
    order: layers.flat(),
    layers,
    entities,
    relations,
    webhooks: ast.webhooks.map((hook) => ({
      id: hook.id,
      entity: String(hook.entity),
      events: hook.events
    }))
  };
}
function mermaidIdent(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}
function schemaToMermaid(graph) {
  const lines = ["erDiagram"];
  for (const entity of graph.entities) {
    lines.push(`  ${mermaidIdent(entity.name)} {`);
    for (const field of entity.fields) {
      const flags = [];
      if (field.name === "id") {
        flags.push("PK");
      }
      if (field.unique && field.name !== "id") {
        flags.push("UK");
      }
      if (field.relation && !field.relation.many) {
        flags.push("FK");
      }
      const type = mermaidIdent(field.displayType);
      const extra = flags.length > 0 ? ` ${flags.join(",")}` : "";
      lines.push(`    ${type} ${mermaidIdent(field.name)}${extra}`);
    }
    lines.push("  }");
  }
  for (const rel of graph.relations) {
    if (rel.many) {
      lines.push(`  ${mermaidIdent(rel.from)} }o--o{ ${mermaidIdent(rel.to)} : "${rel.field} many"`);
      continue;
    }
    const label = `${rel.field} ${rel.onDelete}`;
    lines.push(`  ${mermaidIdent(rel.from)} }o--|| ${mermaidIdent(rel.to)} : "${label}"`);
  }
  return `${lines.join(`
`)}
`;
}
function schemaToJson(graph) {
  return `${JSON.stringify(graph, null, 2)}
`;
}
function webhooksForEntity(graph, entityName) {
  return graph.webhooks.filter((hook) => hook.entity === entityName || hook.entity === "*");
}
// src/relations.ts
function isManyField(field) {
  return Boolean(field?.relation?.many);
}
function columnFields(entity) {
  return entity.fields.filter((field) => !field.relation?.many);
}
function manyFields(entity) {
  return entity.fields.filter((field) => field.relation?.many);
}
var MAX_IDENT = 63;
function fnv(text) {
  let hash = 2166136261;
  for (let i = 0;i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function joinTableName(entity, field) {
  const name = `_bakorin_link_${entity}_${field}`;
  if (name.length <= MAX_IDENT) {
    return name;
  }
  return `_bakorin_link_${entity.slice(0, 20)}_${field.slice(0, 20)}_${fnv(`${entity}.${field}`)}`;
}
var MAX_LINKS_PER_FIELD = 1000;
export {
  APP_YAML_TOP_LEVEL_KEYS,
  BRANDING_DIR,
  BRANDING_FAVICON_EXTENSIONS,
  BRANDING_LOGO_EXTENSIONS,
  BRANDING_MAX_FILE_BYTES,
  BRANDING_SURFACES,
  BakorinError,
  CronError,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEV_JWT_SECRET,
  DestructiveChangeError,
  DiffAbortError,
  FIELD_TYPES,
  IdentError,
  JOB_DEFAULT_RETAIN_DAYS,
  JOB_DEFAULT_TIMEOUT_SECONDS,
  MAIL_DEFAULT_MAX_ATTEMPTS,
  MAIL_DEFAULT_RETAIN_DAYS,
  MAX_LINKS_PER_FIELD,
  MCP_DEFAULTS,
  MIN_JWT_SECRET_LENGTH,
  REALTIME_DEFAULTS,
  RESERVED_ENTITY_NAMES,
  SCHEMA_AST_VERSION,
  SchemaError,
  WEBHOOK_DEFAULT_MAX_ATTEMPTS,
  WEBHOOK_DEFAULT_RETAIN_DAYS,
  WEBHOOK_DEFAULT_TIMEOUT_MS,
  appYamlSchema,
  assertIdent,
  assertPlanApplyable,
  assertStrongJwtSecret,
  brandName,
  brandingCss,
  buildSchemaGraph,
  columnFields,
  compileAppYaml,
  compileBranding,
  contrastRatio,
  describeChange,
  describePolicy,
  deserializeAst,
  destructiveCode,
  diffSchemas,
  ensureContrast,
  formatAppYamlError,
  formatPlan,
  formatZodError,
  generateTypes,
  interpolateEnv,
  invalidPolicyMessage,
  isAppYamlValidationError,
  isDevMode,
  isHexColor,
  isIdent,
  isManyField,
  isValidTimeZone,
  joinTableName,
  latestCronOccurrenceAtOrBefore,
  manyFields,
  matchesCron,
  needsConfirmation,
  nextCronOccurrence,
  normalizeHex,
  parseCron,
  parsePolicies,
  parsePolicy,
  parseTrustProxy,
  policyRequiresAuth,
  quoteChecked,
  quoteIdent,
  rateWindowSeconds,
  schemaToJson,
  schemaToMermaid,
  serializeAst,
  topologicalLayers,
  topologicalOrder,
  touchesExistingData,
  weakJwtSecretReason,
  webhooksForEntity,
  zonedParts,
  zonedToUtc
};
