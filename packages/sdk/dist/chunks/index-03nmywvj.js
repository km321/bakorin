import {
  createClient2
} from "./index-kvbz0pj9.js";

// src/browser.ts
var clients = new Map;
function createBrowserClient2(options = {}) {
  const basePath = options.basePath ?? "/api/bakorin";
  const origin = options.origin ?? (typeof location !== "undefined" ? location.origin : "");
  const key = `${origin}${basePath}`;
  const existing = clients.get(key);
  if (existing)
    return existing;
  const client = createClient2({ baseUrl: origin, apiPath: basePath, credentials: "same-origin", fetch: options.fetch });
  clients.set(key, client);
  return client;
}

export { createBrowserClient2 };
