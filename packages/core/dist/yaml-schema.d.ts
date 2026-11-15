import { z } from "zod";
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
    index?: boolean | undefined;
    values?: string[] | undefined;
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
    index?: boolean | undefined;
    values?: string[] | undefined;
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
        index?: boolean | undefined;
        values?: string[] | undefined;
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
        index?: boolean | undefined;
        values?: string[] | undefined;
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
        index?: boolean | undefined;
        values?: string[] | undefined;
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
    description?: string | undefined;
    label?: string | undefined;
    plural?: string | undefined;
    display?: string | undefined;
    auth?: boolean | undefined;
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
        index?: boolean | undefined;
        values?: string[] | undefined;
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
    description?: string | undefined;
    label?: string | undefined;
    plural?: string | undefined;
    display?: string | undefined;
    auth?: boolean | undefined;
    indexes?: (string | string[])[] | undefined;
    policies?: {
        read?: string | string[] | undefined;
        create?: string | string[] | undefined;
        update?: string | string[] | undefined;
        delete?: string | string[] | undefined;
    } | undefined;
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
        cors: z.ZodOptional<z.ZodObject<{
            origins: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            origins?: string[] | undefined;
        }, {
            origins?: string[] | undefined;
        }>>;
        hooks: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
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
    }, "strict", z.ZodTypeAny, {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
    }, {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>;
    auth?: {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    } | undefined;
    runtime?: {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
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
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    } | undefined;
    webhooks?: {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
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
            index?: boolean | undefined;
            values?: string[] | undefined;
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
        description?: string | undefined;
        label?: string | undefined;
        plural?: string | undefined;
        display?: string | undefined;
        auth?: boolean | undefined;
        indexes?: (string | string[])[] | undefined;
        policies?: {
            read?: string | string[] | undefined;
            create?: string | string[] | undefined;
            update?: string | string[] | undefined;
            delete?: string | string[] | undefined;
        } | undefined;
    }>;
    auth?: {
        password?: string | undefined;
        role?: string | undefined;
        entity?: string | undefined;
        identity?: string | undefined;
        adminRole?: string | undefined;
        requireVerifiedEmail?: boolean | undefined;
    } | undefined;
    runtime?: {
        sqlite?: {
            path: string;
        } | undefined;
        postgres?: {
            url: string;
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
        cors?: {
            origins?: string[] | undefined;
        } | undefined;
        hooks?: string | undefined;
    } | undefined;
    webhooks?: {
        entity: string;
        events: ("create" | "update" | "delete")[];
        url: string;
        secret?: string | undefined;
    }[] | undefined;
}>;
export type AppYaml = z.infer<typeof appYamlSchema>;
export type RawEntity = z.infer<typeof entityObject>;
export type RawField = z.infer<typeof fieldObject>;
export {};
