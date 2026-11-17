// SEC-1: the harness talks only to a loopback LM Studio unless the user explicitly overrides it.
// The host is resolved before the first request, so a name that points elsewhere is caught too.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { hostNotAllowed, requestFailed } from "./errors.ts";

/** Resolves a host name to its addresses. Injected in tests. */
export type HostResolver = (host: string) => Promise<string[]>;

export const systemResolver: HostResolver = async (host) => {
  const results = await lookup(host, { all: true });
  return results.map((result) => result.address);
};

// A BlockList compares parsed addresses, so every spelling of an address matches,
// including the hexadecimal form URL parsing gives IPv4-mapped addresses (::ffff:7f00:1).
const loopbackRanges = new BlockList();
loopbackRanges.addSubnet("127.0.0.0", 8, "ipv4");
loopbackRanges.addAddress("::1", "ipv6");
loopbackRanges.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

export function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return loopbackRanges.check(address, "ipv4");
  if (family === 6) return loopbackRanges.check(address, "ipv6");
  return false;
}

/** URL host names keep the brackets around IPv6 literals; the resolver and isIP do not want them. */
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Throws unless every address the base URL's host resolves to is a loopback address.
 * Every address must pass, because the connection may use any of them.
 */
export async function assertLoopbackHost(
  baseUrl: string,
  resolve: HostResolver = systemResolver,
): Promise<void> {
  const host = bareHost(new URL(baseUrl).hostname);
  if (isIP(host) !== 0) {
    if (!isLoopbackAddress(host)) throw hostNotAllowed(host);
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw requestFailed("resolving the host", `could not resolve ${host}`);
  }
  if (addresses.length === 0 || !addresses.every(isLoopbackAddress)) throw hostNotAllowed(host);
}
