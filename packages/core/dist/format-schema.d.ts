import { ZodError } from "zod";
export declare function isAppYamlValidationError(error: unknown): boolean;
export declare function formatAppYamlError(error: unknown): string;
export declare function formatZodError(error: ZodError): string;
