import { type BakorinClient, type UploadedFile } from "../index.ts";
import { type Store } from "./store.ts";
export interface UploadOptions {
    /** Your site's pass through route. Default /api/bakorin. */
    basePath?: string;
    /** Absolute origin when not uploading from the same site (tests, Node). */
    origin?: string;
    /** 0 to 1 as bytes go out. Needs XMLHttpRequest (browsers). */
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
    /** Checked before sending, so people see a clear message instead of a 413 or 415. */
    maxBytes?: number;
    /** For example ["image/*", "application/pdf"]. */
    accept?: readonly string[];
    /** Used when there is no progress callback or no XMLHttpRequest (Node, tests). */
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
}
/** Matches a MIME type against accept patterns like image/* or application/pdf. */
export declare function acceptsType(type: string, accept: readonly string[] | undefined): boolean;
/** A short reason the file cannot be sent, or undefined when it can. */
export declare function checkFile(file: {
    size: number;
    type: string;
}, options: Pick<UploadOptions, "maxBytes" | "accept">): string | undefined;
export declare function formatBytes(bytes: number): string;
/**
 * Uploads a file through the pass through route, so the httpOnly session cookie
 * signs the request. Reports progress in browsers.
 */
export declare function uploadFile(file: Blob, options?: UploadOptions): Promise<UploadedFile>;
export interface UploadState {
    status: "idle" | "uploading" | "done" | "error";
    /** 0 to 1. */
    progress: number;
    file: UploadedFile | null;
    error: string | null;
}
export interface UploadController {
    store: Store<UploadState>;
    upload(file: Blob): Promise<UploadedFile | null>;
    cancel(): void;
    reset(): void;
}
export declare function createUpload(options?: Omit<UploadOptions, "onProgress" | "signal">): UploadController;
/**
 * A fresh signed link to a file, ready for an img src or a download link. The path
 * goes through the client's base, so in the browser it points at your site.
 */
export declare function signedFileUrl(client: BakorinClient, fileId: string): Promise<string>;
/** Rewrites a signed /api/v1/files/... path from the server onto the client's base. */
export declare function clientFileUrl(client: BakorinClient, signedPath: string): string;
/**
 * Server side: turns a signed file link from a server client (http://bakorin:4371/api/v1/files/...)
 * into a path on your own site (/api/bakorin/files/...), so visitors load it through the
 * pass through route and never need to reach Bakorin directly. Other links come back unchanged.
 */
export declare function siteFileUrl(link: string | undefined | null, options: {
    baseUrl: string;
    basePath?: string;
}): string | undefined;
