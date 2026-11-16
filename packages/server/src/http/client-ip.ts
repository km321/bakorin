import { BlockList, isIP } from "node:net";
import type { Context } from "hono";
import type { TrustProxyAST } from "@bakorin/core";

interface RequestIpServer {
  requestIP?: (request: Request) => { address: string } | null;
}

/** Used when there is no socket, such as app.fetch() in tests or a custom adapter. */
export const UNKNOWN_CLIENT = "unknown";

function normalize(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  let address = value.trim();
  if (address.startsWith("[") && address.includes("]")) {
    address = address.slice(1, address.indexOf("]"));
  }
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(":"));
  }
  if (address.toLowerCase().startsWith("::ffff:") && isIP(address.slice(7)) === 4) {
    address = address.slice(7);
  }
  return isIP(address) ? address : null;
}

/** The TCP peer address from Bun.serve, which the client cannot forge. */
export function socketAddress(c: Context): string | null {
  const server = c.env as RequestIpServer | undefined;
  try {
    return normalize(server?.requestIP?.(c.req.raw)?.address);
  } catch {
    return null;
  }
}

const blockLists = new WeakMap<string[], BlockList>();

function trustedList(cidrs: string[]): BlockList {
  let list = blockLists.get(cidrs);
  if (!list) {
    list = new BlockList();
    for (const cidr of cidrs) {
      const [address = "", bits] = cidr.split("/");
      const family = isIP(address) === 6 ? "ipv6" : "ipv4";
      if (bits === undefined) {
        list.addAddress(address, family);
      } else {
        list.addSubnet(address, Number(bits), family);
      }
    }
    blockLists.set(cidrs, list);
  }
  return list;
}

function isTrusted(list: BlockList, address: string): boolean {
  return list.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/**
 * The client IP for rate limits and the audit log.
 *
 * By default this is the socket address and X-Forwarded-For is ignored, because
 * any client can send that header. With trustProxy set, the address is read from
 * the right end of X-Forwarded-For, where trusted proxies append, so a value a
 * client puts at the left end is never used.
 */
export function resolveClientIp(c: Context, trust: TrustProxyAST): string {
  const socket = socketAddress(c);
  if (trust.kind === "none") {
    return socket ?? UNKNOWN_CLIENT;
  }
  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((item) => normalize(item))
    .filter((item): item is string => item !== null);
  const chain = socket ? [...forwarded, socket] : forwarded;
  if (chain.length === 0) {
    return UNKNOWN_CLIENT;
  }
  if (trust.kind === "hops") {
    const index = chain.length - 1 - trust.hops;
    return chain[Math.max(0, index)] ?? UNKNOWN_CLIENT;
  }
  const list = trustedList(trust.cidrs);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index]!;
    if (!isTrusted(list, address)) {
      return address;
    }
  }
  return chain[0] ?? UNKNOWN_CLIENT;
}

/** Shorthand used by routes: resolves with the app's current trustProxy setting. */
export function clientIp(c: Context): string {
  return resolveClientIp(c, c.get("app").ast.runtime.trustProxy);
}
