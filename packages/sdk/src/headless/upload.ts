import { BakorinRequestError, type BakorinClient, type UploadedFile } from "../index.ts";
import { createStore, type Store } from "./store.ts";

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
export function acceptsType(type: string, accept: readonly string[] | undefined): boolean {
  if (!accept || accept.length === 0) {
    return true;
  }
  const lower = type.toLowerCase();
  return accept.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    return p.endsWith("/*") ? lower.startsWith(p.slice(0, -1)) : lower === p;
  });
}

/** A short reason the file cannot be sent, or undefined when it can. */
export function checkFile(file: { size: number; type: string }, options: Pick<UploadOptions, "maxBytes" | "accept">): string | undefined {
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    return `The file is larger than ${formatBytes(options.maxBytes)}`;
  }
  if (!acceptsType(file.type || "application/octet-stream", options.accept)) {
    return "This file type is not allowed";
  }
  return undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function uploadUrl(options: UploadOptions): string {
  const basePath = (options.basePath ?? "/api/bakorin").replace(/\/+$/, "");
  return `${options.origin ?? ""}${basePath}/files`;
}

/** The server answers with /api/v1/files/...; browsers reach that through the pass through route. */
function throughSite(file: UploadedFile, options: UploadOptions): UploadedFile {
  if (!file.url.startsWith("/api/v1/")) {
    return file;
  }
  const basePath = (options.basePath ?? "/api/bakorin").replace(/\/+$/, "");
  return { ...file, url: `${options.origin ?? ""}${basePath}${file.url.slice("/api/v1".length)}` };
}

function errorFrom(status: number, text: string): BakorinRequestError {
  try {
    const json = JSON.parse(text) as { error?: { message?: string; code?: string; field?: string } };
    return new BakorinRequestError(json.error?.message ?? `upload failed (${status})`, status, json.error?.code ?? "error", json.error?.field);
  } catch {
    return new BakorinRequestError(`upload failed (${status})`, status, "error");
  }
}

/**
 * Uploads a file through the pass through route, so the httpOnly session cookie
 * signs the request. Reports progress in browsers.
 */
export async function uploadFile(file: Blob, options: UploadOptions = {}): Promise<UploadedFile> {
  const problem = checkFile({ size: file.size, type: file.type }, options);
  if (problem) {
    throw new BakorinRequestError(problem, 400, "invalid_file", "file");
  }
  const form = new FormData();
  form.set("file", file, (file as File).name ?? "upload");
  const url = uploadUrl(options);
  if (typeof XMLHttpRequest === "undefined" || !options.onProgress) {
    const fetcher = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
    const response = await fetcher(url, { method: "POST", body: form, credentials: "same-origin", signal: options.signal });
    const text = await response.text();
    if (!response.ok) {
      throw errorFrom(response.status, text);
    }
    options.onProgress?.(1);
    return throughSite((JSON.parse(text) as { data: UploadedFile }).data, options);
  }
  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve(throughSite((JSON.parse(xhr.responseText) as { data: UploadedFile }).data, options));
      } else {
        reject(errorFrom(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new BakorinRequestError("The upload failed. Check your connection.", 0, "network"));
    xhr.onabort = () => reject(new BakorinRequestError("The upload was cancelled.", 0, "aborted"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

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

export function createUpload(options: Omit<UploadOptions, "onProgress" | "signal"> = {}): UploadController {
  const idle: UploadState = { status: "idle", progress: 0, file: null, error: null };
  const store = createStore<UploadState>(idle);
  let controller: AbortController | null = null;
  return {
    store,
    async upload(file) {
      controller?.abort();
      controller = new AbortController();
      store.set({ status: "uploading", progress: 0, file: null, error: null });
      try {
        const uploaded = await uploadFile(file, {
          ...options,
          signal: controller.signal,
          onProgress: (progress) => store.set((state) => ({ ...state, progress })),
        });
        store.set({ status: "done", progress: 1, file: uploaded, error: null });
        return uploaded;
      } catch (error) {
        store.set({ status: "error", progress: 0, file: null, error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    cancel() {
      controller?.abort();
    },
    reset() {
      controller?.abort();
      store.set(idle);
    },
  };
}

/**
 * A fresh signed link to a file, ready for an img src or a download link. The path
 * goes through the client's base, so in the browser it points at your site.
 */
export async function signedFileUrl(client: BakorinClient, fileId: string): Promise<string> {
  return (await client.files.sign(fileId)).url;
}

/** Rewrites a signed /api/v1/files/... path from the server onto the client's base. */
export function clientFileUrl(client: BakorinClient, signedPath: string): string {
  return signedPath.startsWith("/api/v1") ? client.apiUrl(signedPath.slice("/api/v1".length)) : signedPath;
}
