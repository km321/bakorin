export declare class BakorinError extends Error {
    readonly code: string;
    readonly details: unknown;
    constructor(code: string, message: string, details?: unknown);
}
export declare class SchemaError extends BakorinError {
    constructor(message: string, details?: unknown);
}
export declare class DiffAbortError extends BakorinError {
    constructor(message: string, details?: unknown);
}
export declare class IdentError extends BakorinError {
    constructor(message: string, details?: unknown);
}
