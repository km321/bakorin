import { z } from "zod";

const ident = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a letter/underscore followed by letters, digits, or underscores");

const policyExpr = z.string().min(1);
const policyValue = z.union([policyExpr, z.array(policyExpr).min(1)]);

export const FIELD_TYPES = [
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
  "relation",
] as const;

export const APP_YAML_TOP_LEVEL_KEYS = ["app", "branding", "runtime", "auth", "entities", "webhooks", "mail", "jobs"] as const;

const fieldType = z.enum(FIELD_TYPES);

const fieldObject = z
  .object({
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
    private: z.boolean().optional(),
  })
  .strict();

const fieldValue = z.union([fieldType, fieldObject]);

/** A window like 30s, 10m, 1h, 1d, or a number of seconds. */
export const RATE_WINDOW_PATTERN = /^([1-9][0-9]{0,5})(s|m|h|d)$/;

const rateLimitRule = z
  .object({
    limit: z.number().int().min(1).max(1_000_000),
    window: z.union([
      z.string().regex(RATE_WINDOW_PATTERN, "must be a window like 30s, 10m, 1h, or 1d"),
      z.number().int().min(1).max(7 * 24 * 60 * 60),
    ]),
    per: z.enum(["ip", "user"]).optional(),
  })
  .strict();

const entityRateLimit = z
  .object({
    read: rateLimitRule.optional(),
    create: rateLimitRule.optional(),
    update: rateLimitRule.optional(),
    delete: rateLimitRule.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "add at least one of read, create, update, or delete" });

/** How an entity shows in the admin sidebar. Every key is optional. */
const entityAdmin = z
  .object({
    group: z.string().trim().min(1).max(40).optional(),
    order: z.number().int().min(-1000).max(1000).optional(),
    icon: z
      .string()
      .trim()
      .min(1)
      .refine((value) => [...value].length <= 2, { message: "use 1 or 2 characters, like PO or a single emoji" })
      .optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

const entityObject = z
  .object({
    label: z.string().optional(),
    plural: z.string().optional(),
    display: ident.optional(),
    description: z.string().optional(),
    auth: z.boolean().optional(),
    renameFrom: ident.optional(),
    fields: z.record(ident, fieldValue),
    indexes: z.array(z.union([ident, z.array(ident).min(1)])).optional(),
    policies: z
      .object({
        read: policyValue.optional(),
        create: policyValue.optional(),
        update: policyValue.optional(),
        delete: policyValue.optional(),
      })
      .strict()
      .optional(),
    rateLimit: entityRateLimit.optional(),
    realtime: z.union([z.boolean(), z.enum(["full", "ids"])]).optional(),
    admin: entityAdmin.optional(),
  })
  .strict();

const webhookObject = z
  .object({
    entity: z.union([ident, z.literal("*")]),
    events: z.array(z.enum(["create", "update", "delete"])).min(1),
    url: z.string().min(1),
    secret: z.string().optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  })
  .strict();

const mailAddressList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const mailScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const mailCondition = z.union([
  mailScalar,
  z
    .object({
      equals: mailScalar.optional(),
      not: mailScalar.optional(),
      in: z.array(mailScalar).min(1).optional(),
      notIn: z.array(mailScalar).min(1).optional(),
      exists: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "use one of equals, not, in, notIn, or exists",
    }),
]);

const mailRuleObject = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "must be letters, digits, dashes, or underscores")
      .optional(),
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
    maxAttempts: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const hexColor = z
  .string({
    error: (issue) =>
      issue.input === undefined ? undefined : 'must be a quoted hex color like "#0f766e" (without quotes, # starts a YAML comment)',
  })
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #0f766e or #0a7");

function brandingFile(kind: string, extensions: readonly string[]) {
  const pattern = new RegExp(`^(?:\\./)?branding/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.(?:${extensions.join("|")})$`, "i");
  return z
    .string()
    .regex(pattern, `must be a file in the branding/ folder, like branding/${kind}.${extensions[0]} (${extensions.join(", ")})`);
}

const brandingObject = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    primaryColor: hexColor.optional(),
    accentColor: hexColor.optional(),
    logo: brandingFile("logo", ["svg", "png", "jpg", "jpeg", "webp"]).optional(),
    favicon: brandingFile("favicon", ["svg", "png", "ico"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "add at least one of name, primaryColor, accentColor, logo, or favicon, or remove branding",
  });

const jobItem = z
  .object({
    name: ident,
    cron: z.string().min(1),
    handler: ident.optional(),
    timezone: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(86_400).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const appYamlSchema = z
  .object({
    app: z
      .object({
        name: z.string().min(1),
        version: z.string().optional(),
        description: z.string().optional(),
      })
      .strict(),
    branding: brandingObject.optional(),
    runtime: z
      .object({
        dialect: z.enum(["sqlite", "postgres"]).optional(),
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        sqlite: z
          .object({
            path: z.string().min(1),
          })
          .strict()
          .optional(),
        postgres: z
          .object({
            url: z.string().min(1),
          })
          .strict()
          .optional(),
        jwt: z
          .object({
            secret: z.string().min(1).optional(),
            accessTtlSeconds: z.number().int().positive().optional(),
            refreshTtlSeconds: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        files: z
          .object({
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
            rateLimit: rateLimitRule.optional(),
          })
          .strict()
          .optional(),
        backups: z
          .object({
            interval: z.string().optional(),
            cron: z.string().optional(),
            retain: z.number().int().positive().optional(),
            destination: z.string().optional(),
          })
          .strict()
          .optional(),
        alerts: z
          .object({
            email: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
            webhook: z.string().min(1).optional(),
            backupMaxAgeHours: z.number().positive().optional(),
            checkIntervalMinutes: z.number().int().min(1).max(1440).optional(),
          })
          .strict()
          .optional(),
        cors: z
          .object({
            origins: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        hooks: z.string().optional(),
        apiDocs: z.enum(["public", "admin"]).optional(),
        realtime: z
          .object({
            broker: z.enum(["auto", "memory", "postgres"]).optional(),
            maxConnections: z.number().int().min(1).max(1_000_000).optional(),
            maxPerUser: z.number().int().min(1).max(10_000).optional(),
            heartbeatSeconds: z.number().int().min(1).max(300).optional(),
            replayEvents: z.number().int().min(0).max(100_000).optional(),
            retainMinutes: z.number().int().min(1).max(10_080).optional(),
            maxBufferKb: z.number().int().min(1).max(65_536).optional(),
          })
          .strict()
          .optional(),
        mcp: z
          .union([
            z.boolean(),
            z
              .object({
                enabled: z.boolean().optional(),
                sampleLimit: z.number().int().min(1).max(50).optional(),
              })
              .strict(),
          ])
          .optional(),
        trustProxy: z.union([z.boolean(), z.number().int().min(0).max(10), z.array(z.string().min(1)).min(1)]).optional(),
        webhooks: z
          .object({
            retainDays: z.number().int().min(1).max(3650).optional(),
          })
          .strict()
          .optional(),
        mail: z
          .object({
            retainDays: z.number().int().min(1).max(3650).optional(),
          })
          .strict()
          .optional(),
        jobs: z
          .object({
            retainDays: z.number().int().min(1).max(3650).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    auth: z
      .object({
        entity: ident.optional(),
        identity: ident.optional(),
        password: ident.optional(),
        role: ident.optional(),
        adminRole: z.string().optional(),
        requireVerifiedEmail: z.boolean().optional(),
        signup: z.enum(["open", "invite", "closed"]).optional(),
      })
      .strict()
      .optional(),
    entities: z.record(ident, entityObject).refine((value) => Object.keys(value).length > 0, {
      message: "at least one entity is required",
    }),
    webhooks: z.array(webhookObject).optional(),
    mail: z.array(mailRuleObject).optional(),
    jobs: z.array(jobItem).optional(),
  })
  .strict();

export type AppYaml = z.infer<typeof appYamlSchema>;
export type RawEntity = z.infer<typeof entityObject>;
export type RawEntityAdmin = z.infer<typeof entityAdmin>;
export type RawField = z.infer<typeof fieldObject>;
export type RawBrandingYaml = z.infer<typeof brandingObject>;
