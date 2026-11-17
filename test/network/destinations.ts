// Where a connection goes, and whether that place is allowed (SEC-1, SEC-4).

export interface Destination {
  host: string;
  port: number;
}

const loopbackNames = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Lower-cased, without IPv6 brackets, with every loopback name folded into one. */
export function normalizeHost(host: string): string {
  const bare = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return loopbackNames.has(bare) ? "loopback" : bare;
}

export function sameDestination(left: Destination, right: Destination): boolean {
  return left.port === right.port && normalizeHost(left.host) === normalizeHost(right.host);
}

export function isAllowedDestination(destination: Destination, allowed: Destination[]): boolean {
  return allowed.some((candidate) => sameDestination(candidate, destination));
}

/** The LM Studio address from a base URL such as config.lmStudio.baseUrl. */
export function destinationFromUrl(url: string): Destination {
  const parsed = new URL(url);
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : defaultPort };
}

/** Parses "host:port", "[v6]:port", or "v6.addr:port" as lsof and CONNECT write them. */
export function parseEndpoint(text: string): Destination | undefined {
  const match = /^(.*):(\d+)$/.exec(text.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { host: match[1].replace(/^\[(.*)\]$/, "$1"), port: Number(match[2]) };
}

export function formatDestination(destination: Destination): string {
  return destination.host.includes(":")
    ? `[${destination.host}]:${destination.port}`
    : `${destination.host}:${destination.port}`;
}
