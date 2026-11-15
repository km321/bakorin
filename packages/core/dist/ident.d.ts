export declare function assertIdent(name: string, kind: "entity" | "field" | "enum"): string;
export declare function isIdent(name: string): boolean;
export declare function quoteIdent(name: string): string;
/** Quote a name that has already been validated from the AST (includes system tables). */
export declare function quoteChecked(name: string): string;
