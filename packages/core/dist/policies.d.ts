import type { PolicyAST } from "./ast.ts";
export declare function parsePolicy(expr: string): PolicyAST;
export declare function invalidPolicyMessage(expr: string, where?: string): string;
export declare function parsePolicies(value: string | string[] | undefined, fallback: PolicyAST[], where?: string): PolicyAST[];
export declare function policyRequiresAuth(policies: PolicyAST[]): boolean;
export declare function describePolicy(policy: PolicyAST): string;
