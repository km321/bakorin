import { createClient, type ClientOptions } from "./index.ts";

export type { RealtimeChange, RealtimeStatus, SubscribeOptions } from "./index.ts";

type Entities = Record<string, Record<string, unknown>>;

const clients = new Map<string, unknown>();

/**
 * Client for browser code that talks to the pass through route
 * (createAstroProxy or createNextProxy). Requests go to your own site with the
 * httpOnly cookies, so there are no tokens in JavaScript. One client (and one
 * realtime stream) is shared per tab and base path.
 */
export function createBrowserClient<S extends object = Entities>(
  options: { basePath?: string; origin?: string } & Pick<ClientOptions, "fetch"> = {},
) {
  const basePath = options.basePath ?? "/api/bakorin";
  const origin = options.origin ?? (typeof location !== "undefined" ? location.origin : "");
  const key = `${origin}${basePath}`;
  const existing = clients.get(key);
  if (existing) return existing as ReturnType<typeof createClient<S>>;
  const client = createClient<S>({ baseUrl: origin, apiPath: basePath, credentials: "same-origin", fetch: options.fetch });
  clients.set(key, client);
  return client;
}
