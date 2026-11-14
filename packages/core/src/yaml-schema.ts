import { z } from "zod";

const ident = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a letter/underscore followed by letters, digits, or underscores");

const policyExpr = z.string().min(1);
const policyValue = z.union([policyExpr, z.array(policyExpr).min(1)]);

const fieldType = z.enum([
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
]);

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
    renameFrom: ident.optional(),
    secret: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();

const fieldValue = z.union([fieldType, fieldObject]);

const entityObject = z
  .object({
    label: z.string().optional(),
    plural: z.string().optional(),
    display: ident.optional(),
    auth: z.boolean().optional(),
    fields: z.record(ident, fieldValue),
    policies: z
      .object({
        read: policyValue.optional(),
        create: policyValue.optional(),
        update: policyValue.optional(),
        delete: policyValue.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const webhookObject = z
  .object({
    entity: z.union([ident, z.literal("*")]),
    events: z.array(z.enum(["create", "update", "delete"])).min(1),
    url: z.string().min(1),
    secret: z.string().optional(),
  })
  .strict();

export const appYamlSchema = z
  .object({
    app: z
      .object({
        name: z.string().min(1),
        version: z.string().optional(),
      })
      .strict(),
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
        cors: z
          .object({
            origins: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        hooks: z.string().optional(),
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
      })
      .strict()
      .optional(),
    entities: z.record(ident, entityObject).refine((value) => Object.keys(value).length > 0, {
      message: "at least one entity is required",
    }),
    webhooks: z.array(webhookObject).optional(),
  })
  .strict();

export type AppYaml = z.infer<typeof appYamlSchema>;
export type RawEntity = z.infer<typeof entityObject>;
export type RawField = z.infer<typeof fieldObject>;
