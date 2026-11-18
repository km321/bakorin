import { z } from "zod";
export declare const FIELD_TYPES: readonly ["text", "email", "password", "number", "integer", "boolean", "date", "datetime", "enum", "file", "relation", "json", "richtext"];
export declare const APP_YAML_TOP_LEVEL_KEYS: readonly ["app", "branding", "runtime", "auth", "entities", "webhooks", "mail", "jobs"];
declare const fieldObject: z.ZodObject<{
    type: z.ZodEnum<{
        number: "number";
        boolean: "boolean";
        text: "text";
        email: "email";
        password: "password";
        integer: "integer";
        date: "date";
        datetime: "datetime";
        enum: "enum";
        file: "file";
        relation: "relation";
        json: "json";
        richtext: "richtext";
    }>;
    required: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
    values: z.ZodOptional<z.ZodArray<z.ZodString>>;
    to: z.ZodOptional<z.ZodString>;
    onDelete: z.ZodOptional<z.ZodEnum<{
        restrict: "restrict";
        cascade: "cascade";
        set_null: "set_null";
    }>>;
    many: z.ZodOptional<z.ZodBoolean>;
    renameFrom: z.ZodOptional<z.ZodString>;
    secret: z.ZodOptional<z.ZodBoolean>;
    description: z.ZodOptional<z.ZodString>;
    writable: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        none: "none";
    }>>;
    readonly: z.ZodOptional<z.ZodBoolean>;
    adminOnly: z.ZodOptional<z.ZodBoolean>;
    private: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** A window like 30s, 10m, 1h, 1d, or a number of seconds. */
export declare const RATE_WINDOW_PATTERN: RegExp;
/** How an entity shows in the admin sidebar. Every key is optional. */
declare const entityAdmin: z.ZodObject<{
    group: z.ZodOptional<z.ZodString>;
    order: z.ZodOptional<z.ZodNumber>;
    icon: z.ZodOptional<z.ZodString>;
    hidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
declare const entityObject: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    plural: z.ZodOptional<z.ZodString>;
    display: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodBoolean>;
    renameFrom: z.ZodOptional<z.ZodString>;
    fields: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodEnum<{
        number: "number";
        boolean: "boolean";
        text: "text";
        email: "email";
        password: "password";
        integer: "integer";
        date: "date";
        datetime: "datetime";
        enum: "enum";
        file: "file";
        relation: "relation";
        json: "json";
        richtext: "richtext";
    }>, z.ZodObject<{
        type: z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            text: "text";
            email: "email";
            password: "password";
            integer: "integer";
            date: "date";
            datetime: "datetime";
            enum: "enum";
            file: "file";
            relation: "relation";
            json: "json";
            richtext: "richtext";
        }>;
        required: z.ZodOptional<z.ZodBoolean>;
        unique: z.ZodOptional<z.ZodBoolean>;
        index: z.ZodOptional<z.ZodBoolean>;
        default: z.ZodOptional<z.ZodUnknown>;
        values: z.ZodOptional<z.ZodArray<z.ZodString>>;
        to: z.ZodOptional<z.ZodString>;
        onDelete: z.ZodOptional<z.ZodEnum<{
            restrict: "restrict";
            cascade: "cascade";
            set_null: "set_null";
        }>>;
        many: z.ZodOptional<z.ZodBoolean>;
        renameFrom: z.ZodOptional<z.ZodString>;
        secret: z.ZodOptional<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
        writable: z.ZodOptional<z.ZodEnum<{
            admin: "admin";
            none: "none";
        }>>;
        readonly: z.ZodOptional<z.ZodBoolean>;
        adminOnly: z.ZodOptional<z.ZodBoolean>;
        private: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>]>>;
    indexes: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
    policies: z.ZodOptional<z.ZodObject<{
        read: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        create: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        update: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        delete: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    }, z.core.$strict>>;
    rateLimit: z.ZodOptional<z.ZodObject<{
        read: z.ZodOptional<z.ZodObject<{
            limit: z.ZodNumber;
            window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            per: z.ZodOptional<z.ZodEnum<{
                ip: "ip";
                user: "user";
            }>>;
        }, z.core.$strict>>;
        create: z.ZodOptional<z.ZodObject<{
            limit: z.ZodNumber;
            window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            per: z.ZodOptional<z.ZodEnum<{
                ip: "ip";
                user: "user";
            }>>;
        }, z.core.$strict>>;
        update: z.ZodOptional<z.ZodObject<{
            limit: z.ZodNumber;
            window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            per: z.ZodOptional<z.ZodEnum<{
                ip: "ip";
                user: "user";
            }>>;
        }, z.core.$strict>>;
        delete: z.ZodOptional<z.ZodObject<{
            limit: z.ZodNumber;
            window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            per: z.ZodOptional<z.ZodEnum<{
                ip: "ip";
                user: "user";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    realtime: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodEnum<{
        full: "full";
        ids: "ids";
    }>]>>;
    admin: z.ZodOptional<z.ZodObject<{
        group: z.ZodOptional<z.ZodString>;
        order: z.ZodOptional<z.ZodNumber>;
        icon: z.ZodOptional<z.ZodString>;
        hidden: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
declare const brandingObject: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    primaryColor: z.ZodOptional<z.ZodString>;
    accentColor: z.ZodOptional<z.ZodString>;
    logo: z.ZodOptional<z.ZodString>;
    favicon: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const appYamlSchema: z.ZodObject<{
    app: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    branding: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        primaryColor: z.ZodOptional<z.ZodString>;
        accentColor: z.ZodOptional<z.ZodString>;
        logo: z.ZodOptional<z.ZodString>;
        favicon: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    runtime: z.ZodOptional<z.ZodObject<{
        dialect: z.ZodOptional<z.ZodEnum<{
            sqlite: "sqlite";
            postgres: "postgres";
        }>>;
        host: z.ZodOptional<z.ZodString>;
        port: z.ZodOptional<z.ZodNumber>;
        sqlite: z.ZodOptional<z.ZodObject<{
            path: z.ZodString;
        }, z.core.$strict>>;
        postgres: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strict>>;
        jwt: z.ZodOptional<z.ZodObject<{
            secret: z.ZodOptional<z.ZodString>;
            accessTtlSeconds: z.ZodOptional<z.ZodNumber>;
            refreshTtlSeconds: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        files: z.ZodOptional<z.ZodObject<{
            driver: z.ZodOptional<z.ZodEnum<{
                local: "local";
                s3: "s3";
            }>>;
            path: z.ZodOptional<z.ZodString>;
            bucket: z.ZodOptional<z.ZodString>;
            endpoint: z.ZodOptional<z.ZodString>;
            accessKey: z.ZodOptional<z.ZodString>;
            secretKey: z.ZodOptional<z.ZodString>;
            region: z.ZodOptional<z.ZodString>;
            virtualHostedStyle: z.ZodOptional<z.ZodBoolean>;
            pathStyle: z.ZodOptional<z.ZodBoolean>;
            maxBytes: z.ZodOptional<z.ZodNumber>;
            allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
            signedUrlTtlSeconds: z.ZodOptional<z.ZodNumber>;
            rateLimit: z.ZodOptional<z.ZodObject<{
                limit: z.ZodNumber;
                window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                per: z.ZodOptional<z.ZodEnum<{
                    ip: "ip";
                    user: "user";
                }>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        backups: z.ZodOptional<z.ZodObject<{
            interval: z.ZodOptional<z.ZodString>;
            cron: z.ZodOptional<z.ZodString>;
            retain: z.ZodOptional<z.ZodNumber>;
            destination: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        alerts: z.ZodOptional<z.ZodObject<{
            email: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            webhook: z.ZodOptional<z.ZodString>;
            backupMaxAgeHours: z.ZodOptional<z.ZodNumber>;
            checkIntervalMinutes: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        cors: z.ZodOptional<z.ZodObject<{
            origins: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        hooks: z.ZodOptional<z.ZodString>;
        apiDocs: z.ZodOptional<z.ZodEnum<{
            public: "public";
            admin: "admin";
        }>>;
        realtime: z.ZodOptional<z.ZodObject<{
            broker: z.ZodOptional<z.ZodEnum<{
                postgres: "postgres";
                auto: "auto";
                memory: "memory";
            }>>;
            maxConnections: z.ZodOptional<z.ZodNumber>;
            maxPerUser: z.ZodOptional<z.ZodNumber>;
            heartbeatSeconds: z.ZodOptional<z.ZodNumber>;
            replayEvents: z.ZodOptional<z.ZodNumber>;
            retainMinutes: z.ZodOptional<z.ZodNumber>;
            maxBufferKb: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        mcp: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            sampleLimit: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
        trustProxy: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodNumber, z.ZodArray<z.ZodString>]>>;
        webhooks: z.ZodOptional<z.ZodObject<{
            retainDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        mail: z.ZodOptional<z.ZodObject<{
            retainDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        jobs: z.ZodOptional<z.ZodObject<{
            retainDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    auth: z.ZodOptional<z.ZodObject<{
        entity: z.ZodOptional<z.ZodString>;
        identity: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodString>;
        adminRole: z.ZodOptional<z.ZodString>;
        requireVerifiedEmail: z.ZodOptional<z.ZodBoolean>;
        signup: z.ZodOptional<z.ZodEnum<{
            open: "open";
            invite: "invite";
            closed: "closed";
        }>>;
    }, z.core.$strict>>;
    entities: z.ZodRecord<z.ZodString, z.ZodObject<{
        label: z.ZodOptional<z.ZodString>;
        plural: z.ZodOptional<z.ZodString>;
        display: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        auth: z.ZodOptional<z.ZodBoolean>;
        renameFrom: z.ZodOptional<z.ZodString>;
        fields: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            text: "text";
            email: "email";
            password: "password";
            integer: "integer";
            date: "date";
            datetime: "datetime";
            enum: "enum";
            file: "file";
            relation: "relation";
            json: "json";
            richtext: "richtext";
        }>, z.ZodObject<{
            type: z.ZodEnum<{
                number: "number";
                boolean: "boolean";
                text: "text";
                email: "email";
                password: "password";
                integer: "integer";
                date: "date";
                datetime: "datetime";
                enum: "enum";
                file: "file";
                relation: "relation";
                json: "json";
                richtext: "richtext";
            }>;
            required: z.ZodOptional<z.ZodBoolean>;
            unique: z.ZodOptional<z.ZodBoolean>;
            index: z.ZodOptional<z.ZodBoolean>;
            default: z.ZodOptional<z.ZodUnknown>;
            values: z.ZodOptional<z.ZodArray<z.ZodString>>;
            to: z.ZodOptional<z.ZodString>;
            onDelete: z.ZodOptional<z.ZodEnum<{
                restrict: "restrict";
                cascade: "cascade";
                set_null: "set_null";
            }>>;
            many: z.ZodOptional<z.ZodBoolean>;
            renameFrom: z.ZodOptional<z.ZodString>;
            secret: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            writable: z.ZodOptional<z.ZodEnum<{
                admin: "admin";
                none: "none";
            }>>;
            readonly: z.ZodOptional<z.ZodBoolean>;
            adminOnly: z.ZodOptional<z.ZodBoolean>;
            private: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>]>>;
        indexes: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
        policies: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            create: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            update: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            delete: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        }, z.core.$strict>>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodObject<{
                limit: z.ZodNumber;
                window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                per: z.ZodOptional<z.ZodEnum<{
                    ip: "ip";
                    user: "user";
                }>>;
            }, z.core.$strict>>;
            create: z.ZodOptional<z.ZodObject<{
                limit: z.ZodNumber;
                window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                per: z.ZodOptional<z.ZodEnum<{
                    ip: "ip";
                    user: "user";
                }>>;
            }, z.core.$strict>>;
            update: z.ZodOptional<z.ZodObject<{
                limit: z.ZodNumber;
                window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                per: z.ZodOptional<z.ZodEnum<{
                    ip: "ip";
                    user: "user";
                }>>;
            }, z.core.$strict>>;
            delete: z.ZodOptional<z.ZodObject<{
                limit: z.ZodNumber;
                window: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                per: z.ZodOptional<z.ZodEnum<{
                    ip: "ip";
                    user: "user";
                }>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        realtime: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodEnum<{
            full: "full";
            ids: "ids";
        }>]>>;
        admin: z.ZodOptional<z.ZodObject<{
            group: z.ZodOptional<z.ZodString>;
            order: z.ZodOptional<z.ZodNumber>;
            icon: z.ZodOptional<z.ZodString>;
            hidden: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    webhooks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        entity: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"*">]>;
        events: z.ZodArray<z.ZodEnum<{
            create: "create";
            update: "update";
            delete: "delete";
        }>>;
        url: z.ZodString;
        secret: z.ZodOptional<z.ZodString>;
        maxAttempts: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    mail: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        entity: z.ZodString;
        events: z.ZodArray<z.ZodEnum<{
            create: "create";
            update: "update";
            delete: "delete";
        }>>;
        to: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
        cc: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        bcc: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        replyTo: z.ZodOptional<z.ZodString>;
        subject: z.ZodOptional<z.ZodString>;
        template: z.ZodString;
        when: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>, z.ZodObject<{
            equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            not: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            in: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            notIn: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            exists: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>]>>>;
        changed: z.ZodOptional<z.ZodArray<z.ZodString>>;
        expand: z.ZodOptional<z.ZodArray<z.ZodString>>;
        maxAttempts: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    jobs: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        cron: z.ZodString;
        handler: z.ZodOptional<z.ZodString>;
        timezone: z.ZodOptional<z.ZodString>;
        dryRun: z.ZodOptional<z.ZodBoolean>;
        timeoutSeconds: z.ZodOptional<z.ZodNumber>;
        enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type AppYaml = z.infer<typeof appYamlSchema>;
export type RawEntity = z.infer<typeof entityObject>;
export type RawEntityAdmin = z.infer<typeof entityAdmin>;
export type RawField = z.infer<typeof fieldObject>;
export type RawBrandingYaml = z.infer<typeof brandingObject>;
export {};
