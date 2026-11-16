import { z } from "zod";
export declare const FIELD_TYPES: readonly ["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"];
export declare const APP_YAML_TOP_LEVEL_KEYS: readonly ["app", "branding", "runtime", "auth", "entities", "webhooks", "mail"];
declare const fieldObject: z.ZodObject<{
    type: z.ZodEnum<["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"]>;
    required: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
    values: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    to: z.ZodOptional<z.ZodString>;
    onDelete: z.ZodOptional<z.ZodEnum<["restrict", "cascade", "set_null"]>>;
    renameFrom: z.ZodOptional<z.ZodString>;
    secret: z.ZodOptional<z.ZodBoolean>;
    description: z.ZodOptional<z.ZodString>;
    writable: z.ZodOptional<z.ZodEnum<["admin", "none"]>>;
    readonly: z.ZodOptional<z.ZodBoolean>;
    adminOnly: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
    values?: string[] | undefined;
    index?: boolean | undefined;
    required?: boolean | undefined;
    unique?: boolean | undefined;
    default?: unknown;
    to?: string | undefined;
    onDelete?: "restrict" | "cascade" | "set_null" | undefined;
    renameFrom?: string | undefined;
    secret?: boolean | undefined;
    description?: string | undefined;
    writable?: "admin" | "none" | undefined;
    readonly?: boolean | undefined;
    adminOnly?: boolean | undefined;
}, {
    type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
    values?: string[] | undefined;
    index?: boolean | undefined;
    required?: boolean | undefined;
    unique?: boolean | undefined;
    default?: unknown;
    to?: string | undefined;
    onDelete?: "restrict" | "cascade" | "set_null" | undefined;
    renameFrom?: string | undefined;
    secret?: boolean | undefined;
    description?: string | undefined;
    writable?: "admin" | "none" | undefined;
    readonly?: boolean | undefined;
    adminOnly?: boolean | undefined;
}>;
declare const entityObject: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    plural: z.ZodOptional<z.ZodString>;
    display: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodBoolean>;
    renameFrom: z.ZodOptional<z.ZodString>;
    fields: z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodEnum<["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"]>, z.ZodObject<{
        type: z.ZodEnum<["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"]>;
        required: z.ZodOptional<z.ZodBoolean>;
        unique: z.ZodOptional<z.ZodBoolean>;
        index: z.ZodOptional<z.ZodBoolean>;
        default: z.ZodOptional<z.ZodUnknown>;
        values: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        to: z.ZodOptional<z.ZodString>;
        onDelete: z.ZodOptional<z.ZodEnum<["restrict", "cascade", "set_null"]>>;
        renameFrom: z.ZodOptional<z.ZodString>;
        secret: z.ZodOptional<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
        writable: z.ZodOptional<z.ZodEnum<["admin", "none"]>>;
        readonly: z.ZodOptional<z.ZodBoolean>;
        adminOnly: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
        values?: string[] | undefined;
        index?: boolean | undefined;
        required?: boolean | undefined;
        unique?: boolean | undefined;
        default?: unknown;
        to?: string | undefined;
        onDelete?: "restrict" | "cascade" | "set_null" | undefined;
        renameFrom?: string | undefined;
        secret?: boolean | undefined;
        description?: string | undefined;
        writable?: "admin" | "none" | undefined;
        readonly?: boolean | undefined;
        adminOnly?: boolean | undefined;
    }, {
        type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
        values?: string[] | undefined;
        index?: boolean | undefined;
        required?: boolean | undefined;
        unique?: boolean | undefined;
        default?: unknown;
        to?: string | undefined;
        onDelete?: "restrict" | "cascade" | "set_null" | undefined;
        renameFrom?: string | undefined;
        secret?: boolean | undefined;
        description?: string | undefined;
        writable?: "admin" | "none" | undefined;
        readonly?: boolean | undefined;
        adminOnly?: boolean | undefined;
    }>]>>;
    indexes: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>, "many">>;
    policies: z.ZodOptional<z.ZodObject<{
        read: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        create: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        update: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        delete: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
    }, "strict", z.ZodTypeAny, {
        read?: string | string[] | undefined;
        create?: string | string[] | undefined;
        update?: string | string[] | undefined;
        delete?: string | string[] | undefined;
    }, {
        read?: string | string[] | undefined;
        create?: string | string[] | undefined;
        update?: string | string[] | undefined;
        delete?: string | string[] | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
        type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
        values?: string[] | undefined;
        index?: boolean | undefined;
        required?: boolean | undefined;
        unique?: boolean | undefined;
        default?: unknown;
        to?: string | undefined;
        onDelete?: "restrict" | "cascade" | "set_null" | undefined;
        renameFrom?: string | undefined;
        secret?: boolean | undefined;
        description?: string | undefined;
        writable?: "admin" | "none" | undefined;
        readonly?: boolean | undefined;
        adminOnly?: boolean | undefined;
    }>;
    auth?: boolean | undefined;
    renameFrom?: string | undefined;
    description?: string | undefined;
    label?: string | undefined;
    plural?: string | undefined;
    display?: string | undefined;
    indexes?: (string | string[])[] | undefined;
    policies?: {
        read?: string | string[] | undefined;
        create?: string | string[] | undefined;
        update?: string | string[] | undefined;
        delete?: string | string[] | undefined;
    } | undefined;
}, {
    fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
        type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
        values?: string[] | undefined;
        index?: boolean | undefined;
        required?: boolean | undefined;
        unique?: boolean | undefined;
        default?: unknown;
        to?: string | undefined;
        onDelete?: "restrict" | "cascade" | "set_null" | undefined;
        renameFrom?: string | undefined;
        secret?: boolean | undefined;
        description?: string | undefined;
        writable?: "admin" | "none" | undefined;
        readonly?: boolean | undefined;
        adminOnly?: boolean | undefined;
    }>;
    auth?: boolean | undefined;
    renameFrom?: string | undefined;
    description?: string | undefined;
    label?: string | undefined;
    plural?: string | undefined;
    display?: string | undefined;
    indexes?: (string | string[])[] | undefined;
    policies?: {
        read?: string | string[] | undefined;
        create?: string | string[] | undefined;
        update?: string | string[] | undefined;
        delete?: string | string[] | undefined;
    } | undefined;
}>;
declare const brandingObject: z.ZodEffects<z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    primaryColor: z.ZodOptional<z.ZodString>;
    accentColor: z.ZodOptional<z.ZodString>;
    logo: z.ZodOptional<z.ZodString>;
    favicon: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name?: string | undefined;
    logo?: string | undefined;
    favicon?: string | undefined;
    primaryColor?: string | undefined;
    accentColor?: string | undefined;
}, {
    name?: string | undefined;
    logo?: string | undefined;
    favicon?: string | undefined;
    primaryColor?: string | undefined;
    accentColor?: string | undefined;
}>, {
    name?: string | undefined;
    logo?: string | undefined;
    favicon?: string | undefined;
    primaryColor?: string | undefined;
    accentColor?: string | undefined;
}, {
    name?: string | undefined;
    logo?: string | undefined;
    favicon?: string | undefined;
    primaryColor?: string | undefined;
    accentColor?: string | undefined;
}>;
export declare const appYamlSchema: z.ZodObject<{
    app: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        version?: string | undefined;
    }, {
        name: string;
        description?: string | undefined;
        version?: string | undefined;
    }>;
    branding: z.ZodOptional<z.ZodEffects<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        primaryColor: z.ZodOptional<z.ZodString>;
        accentColor: z.ZodOptional<z.ZodString>;
        logo: z.ZodOptional<z.ZodString>;
        favicon: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    }, {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    }>, {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    }, {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    }>>;
    runtime: z.ZodOptional<z.ZodObject<{
        dialect: z.ZodOptional<z.ZodEnum<["sqlite", "postgres"]>>;
        host: z.ZodOptional<z.ZodString>;
        port: z.ZodOptional<z.ZodNumber>;
        sqlite: z.ZodOptional<z.ZodObject<{
            path: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            path: string;
        }, {
            path: string;
        }>>;
        postgres: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>>;
        jwt: z.ZodOptional<z.ZodObject<{
            secret: z.ZodOptional<z.ZodString>;
            accessTtlSeconds: z.ZodOptional<z.ZodNumber>;
            refreshTtlSeconds: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        }, {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        }>>;
        files: z.ZodOptional<z.ZodObject<{
            driver: z.ZodOptional<z.ZodEnum<["local", "s3"]>>;
            path: z.ZodOptional<z.ZodString>;
            bucket: z.ZodOptional<z.ZodString>;
            endpoint: z.ZodOptional<z.ZodString>;
            accessKey: z.ZodOptional<z.ZodString>;
            secretKey: z.ZodOptional<z.ZodString>;
            region: z.ZodOptional<z.ZodString>;
            virtualHostedStyle: z.ZodOptional<z.ZodBoolean>;
            pathStyle: z.ZodOptional<z.ZodBoolean>;
            maxBytes: z.ZodOptional<z.ZodNumber>;
            allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            signedUrlTtlSeconds: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        }, {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        }>>;
        backups: z.ZodOptional<z.ZodObject<{
            interval: z.ZodOptional<z.ZodString>;
            cron: z.ZodOptional<z.ZodString>;
            retain: z.ZodOptional<z.ZodNumber>;
            destination: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        }, {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        }>>;
        alerts: z.ZodOptional<z.ZodObject<{
            email: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
            webhook: z.ZodOptional<z.ZodString>;
            backupMaxAgeHours: z.ZodOptional<z.ZodNumber>;
            checkIntervalMinutes: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        }, {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        }>>;
        cors: z.ZodOptional<z.ZodObject<{
            origins: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            origins?: string[] | undefined;
        }, {
            origins?: string[] | undefined;
        }>>;
        hooks: z.ZodOptional<z.ZodString>;
        webhooks: z.ZodOptional<z.ZodObject<{
            retainDays: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            retainDays?: number | undefined;
        }, {
            retainDays?: number | undefined;
        }>>;
        mail: z.ZodOptional<z.ZodObject<{
            retainDays: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            retainDays?: number | undefined;
        }, {
            retainDays?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
        } | undefined;
        webhooks?: {
            retainDays?: number | undefined;
        } | undefined;
        mail?: {
            retainDays?: number | undefined;
        } | undefined;
        dialect?: "sqlite" | "postgres" | undefined;
        host?: string | undefined;
        port?: number | undefined;
        jwt?: {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        } | undefined;
        files?: {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        } | undefined;
        backups?: {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        } | undefined;
        alerts?: {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        } | undefined;
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    }, {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
        } | undefined;
        webhooks?: {
            retainDays?: number | undefined;
        } | undefined;
        mail?: {
            retainDays?: number | undefined;
        } | undefined;
        dialect?: "sqlite" | "postgres" | undefined;
        host?: string | undefined;
        port?: number | undefined;
        jwt?: {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        } | undefined;
        files?: {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        } | undefined;
        backups?: {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        } | undefined;
        alerts?: {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        } | undefined;
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    }>>;
    auth: z.ZodOptional<z.ZodObject<{
        entity: z.ZodOptional<z.ZodString>;
        identity: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodString>;
        adminRole: z.ZodOptional<z.ZodString>;
        requireVerifiedEmail: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    }, {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    }>>;
    entities: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodObject<{
        label: z.ZodOptional<z.ZodString>;
        plural: z.ZodOptional<z.ZodString>;
        display: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        auth: z.ZodOptional<z.ZodBoolean>;
        renameFrom: z.ZodOptional<z.ZodString>;
        fields: z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodEnum<["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"]>, z.ZodObject<{
            type: z.ZodEnum<["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation"]>;
            required: z.ZodOptional<z.ZodBoolean>;
            unique: z.ZodOptional<z.ZodBoolean>;
            index: z.ZodOptional<z.ZodBoolean>;
            default: z.ZodOptional<z.ZodUnknown>;
            values: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            to: z.ZodOptional<z.ZodString>;
            onDelete: z.ZodOptional<z.ZodEnum<["restrict", "cascade", "set_null"]>>;
            renameFrom: z.ZodOptional<z.ZodString>;
            secret: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            writable: z.ZodOptional<z.ZodEnum<["admin", "none"]>>;
            readonly: z.ZodOptional<z.ZodBoolean>;
            adminOnly: z.ZodOptional<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }, {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>]>>;
        indexes: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>, "many">>;
        policies: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
            create: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
            update: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
            delete: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        }, "strict", z.ZodTypeAny, {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        }, {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>>, Record<string, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>, Record<string, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>>;
    webhooks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        entity: z.ZodUnion<[z.ZodString, z.ZodLiteral<"*">]>;
        events: z.ZodArray<z.ZodEnum<["create", "update", "delete"]>, "many">;
        url: z.ZodString;
        secret: z.ZodOptional<z.ZodString>;
        maxAttempts: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
        maxAttempts?: number | undefined;
        timeoutMs?: number | undefined;
    }, {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
        maxAttempts?: number | undefined;
        timeoutMs?: number | undefined;
    }>, "many">>;
    mail: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        entity: z.ZodString;
        events: z.ZodArray<z.ZodEnum<["create", "update", "delete"]>, "many">;
        to: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
        cc: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        bcc: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        replyTo: z.ZodOptional<z.ZodString>;
        subject: z.ZodOptional<z.ZodString>;
        template: z.ZodString;
        when: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>, z.ZodEffects<z.ZodObject<{
            equals: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            not: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            in: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>, "many">>;
            notIn: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>, "many">>;
            exists: z.ZodOptional<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        }, {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        }>, {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        }, {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        }>]>>>;
        changed: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        expand: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        maxAttempts: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        entity: string;
        to: string | string[];
        events: ("create" | "update" | "delete")[];
        template: string;
        name?: string | undefined;
        maxAttempts?: number | undefined;
        cc?: string | string[] | undefined;
        bcc?: string | string[] | undefined;
        replyTo?: string | undefined;
        subject?: string | undefined;
        when?: Record<string, string | number | boolean | {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        } | null> | undefined;
        changed?: string[] | undefined;
        expand?: string[] | undefined;
    }, {
        entity: string;
        to: string | string[];
        events: ("create" | "update" | "delete")[];
        template: string;
        name?: string | undefined;
        maxAttempts?: number | undefined;
        cc?: string | string[] | undefined;
        bcc?: string | string[] | undefined;
        replyTo?: string | undefined;
        subject?: string | undefined;
        when?: Record<string, string | number | boolean | {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        } | null> | undefined;
        changed?: string[] | undefined;
        expand?: string[] | undefined;
    }>, "many">>;
}, "strict", z.ZodTypeAny, {
    app: {
        name: string;
        description?: string | undefined;
        version?: string | undefined;
    };
    entities: Record<string, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>;
    branding?: {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    } | undefined;
    runtime?: {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
        } | undefined;
        webhooks?: {
            retainDays?: number | undefined;
        } | undefined;
        mail?: {
            retainDays?: number | undefined;
        } | undefined;
        dialect?: "sqlite" | "postgres" | undefined;
        host?: string | undefined;
        port?: number | undefined;
        jwt?: {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        } | undefined;
        files?: {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        } | undefined;
        backups?: {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        } | undefined;
        alerts?: {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        } | undefined;
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    } | undefined;
    auth?: {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    } | undefined;
    webhooks?: {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
        maxAttempts?: number | undefined;
        timeoutMs?: number | undefined;
    }[] | undefined;
    mail?: {
        entity: string;
        to: string | string[];
        events: ("create" | "update" | "delete")[];
        template: string;
        name?: string | undefined;
        maxAttempts?: number | undefined;
        cc?: string | string[] | undefined;
        bcc?: string | string[] | undefined;
        replyTo?: string | undefined;
        subject?: string | undefined;
        when?: Record<string, string | number | boolean | {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        } | null> | undefined;
        changed?: string[] | undefined;
        expand?: string[] | undefined;
    }[] | undefined;
}, {
    app: {
        name: string;
        description?: string | undefined;
        version?: string | undefined;
    };
    entities: Record<string, {
        fields: Record<string, "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation" | {
            type: "number" | "boolean" | "text" | "email" | "password" | "integer" | "date" | "datetime" | "enum" | "file" | "relation";
            values?: string[] | undefined;
            index?: boolean | undefined;
            required?: boolean | undefined;
            unique?: boolean | undefined;
            default?: unknown;
            to?: string | undefined;
            onDelete?: "restrict" | "cascade" | "set_null" | undefined;
            renameFrom?: string | undefined;
            secret?: boolean | undefined;
            description?: string | undefined;
            writable?: "admin" | "none" | undefined;
            readonly?: boolean | undefined;
            adminOnly?: boolean | undefined;
        }>;
        auth?: boolean | undefined;
        renameFrom?: string | undefined;
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>;
    branding?: {
        name?: string | undefined;
        logo?: string | undefined;
        favicon?: string | undefined;
        primaryColor?: string | undefined;
        accentColor?: string | undefined;
    } | undefined;
    runtime?: {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
        } | undefined;
        webhooks?: {
            retainDays?: number | undefined;
        } | undefined;
        mail?: {
            retainDays?: number | undefined;
        } | undefined;
        dialect?: "sqlite" | "postgres" | undefined;
        host?: string | undefined;
        port?: number | undefined;
        jwt?: {
            secret?: string | undefined;
            accessTtlSeconds?: number | undefined;
            refreshTtlSeconds?: number | undefined;
        } | undefined;
        files?: {
            path?: string | undefined;
            driver?: "local" | "s3" | undefined;
            bucket?: string | undefined;
            endpoint?: string | undefined;
            accessKey?: string | undefined;
            secretKey?: string | undefined;
            region?: string | undefined;
            virtualHostedStyle?: boolean | undefined;
            pathStyle?: boolean | undefined;
            maxBytes?: number | undefined;
            allowedMimeTypes?: string[] | undefined;
            signedUrlTtlSeconds?: number | undefined;
        } | undefined;
        backups?: {
            interval?: string | undefined;
            cron?: string | undefined;
            retain?: number | undefined;
            destination?: string | undefined;
        } | undefined;
        alerts?: {
            email?: string | string[] | undefined;
            webhook?: string | undefined;
            backupMaxAgeHours?: number | undefined;
            checkIntervalMinutes?: number | undefined;
        } | undefined;
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    } | undefined;
    auth?: {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    } | undefined;
    webhooks?: {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
        maxAttempts?: number | undefined;
        timeoutMs?: number | undefined;
    }[] | undefined;
    mail?: {
        entity: string;
        to: string | string[];
        events: ("create" | "update" | "delete")[];
        template: string;
        name?: string | undefined;
        maxAttempts?: number | undefined;
        cc?: string | string[] | undefined;
        bcc?: string | string[] | undefined;
        replyTo?: string | undefined;
        subject?: string | undefined;
        when?: Record<string, string | number | boolean | {
            equals?: string | number | boolean | null | undefined;
            not?: string | number | boolean | null | undefined;
            in?: (string | number | boolean | null)[] | undefined;
            notIn?: (string | number | boolean | null)[] | undefined;
            exists?: boolean | undefined;
        } | null> | undefined;
        changed?: string[] | undefined;
        expand?: string[] | undefined;
    }[] | undefined;
}>;
export type AppYaml = z.infer<typeof appYamlSchema>;
export type RawEntity = z.infer<typeof entityObject>;
export type RawField = z.infer<typeof fieldObject>;
export type RawBrandingYaml = z.infer<typeof brandingObject>;
export {};
