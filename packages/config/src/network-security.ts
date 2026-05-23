import { isIP } from "node:net";

export type ResolvedAddress = { address: string; family: number };

export function validateWebhookTargetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid webhook URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("webhook URL must use http or https");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("webhook URL credentials are not allowed");
  }

  const rawHost = extractRawUrlHost(rawUrl);
  if (rawHost) {
    assertSafeWebhookHost(rawHost);
  }
  assertSafeWebhookHost(url.hostname);

  return url;
}

export function assertSafeResolvedAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0) {
    throw new Error("Webhook DNS resolution failed");
  }

  for (const address of addresses) {
    assertSafeWebhookHost(address.address);
  }
}

export function assertSafeWebhookHost(rawHost: string): void {
  if (isUnsafeWebhookHost(rawHost)) {
    throw new Error("unsafe webhook target");
  }
}

export function isUnsafeWebhookHost(rawHost: string): boolean {
  const host = normalizeLiteralHost(rawHost);

  if (host === "localhost") {
    return true;
  }

  const mappedIpv4Host = parseIpv4MappedIpv6Host(host);
  if (mappedIpv4Host) {
    return isUnsafeIpv4Host(mappedIpv4Host);
  }

  const ipv4Octets = parseStrictIpv4Host(host);
  if (ipv4Octets) {
    return isUnsafeIpv4Octets(ipv4Octets);
  }

  if (looksLikeInvalidIpv4Host(host)) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 6) {
    return isUnsafeIpv6Host(host);
  }

  return false;
}

function extractRawUrlHost(rawUrl: string): string | undefined {
  const schemeEnd = rawUrl.indexOf("://");
  if (schemeEnd === -1) {
    return undefined;
  }

  const authority = rawUrl.slice(schemeEnd + 3).split(/[/?#]/, 1)[0];
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    return end === -1 ? undefined : hostPort.slice(0, end + 1);
  }

  return hostPort.split(":", 1)[0];
}

function normalizeLiteralHost(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function looksLikeInvalidIpv4Host(host: string): boolean {
  return host.includes(".") && /^[0-9.]+$/.test(host) && parseStrictIpv4Host(host) === null;
}

function parseStrictIpv4Host(host: string): number[] | null {
  const octets = host.split(".");
  if (octets.length !== 4) {
    return null;
  }

  const parsed: number[] = [];
  for (const octet of octets) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(octet)) {
      return null;
    }

    const value = Number(octet);
    if (value > 255) {
      return null;
    }
    parsed.push(value);
  }

  return parsed;
}

function parseIpv4MappedIpv6Host(host: string): string | null {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) {
    return null;
  }

  const hasMappedPrefix = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  if (!hasMappedPrefix) {
    return null;
  }

  return [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join(".");
}

function parseIpv6Hextets(host: string): number[] | null {
  if (!host.includes(":") || host.includes("%")) {
    return null;
  }

  const doubleColonParts = host.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const head = parseIpv6Part(doubleColonParts[0] ?? "");
  const tail = parseIpv6Part(doubleColonParts[1] ?? "");
  if (!head || !tail) {
    return null;
  }

  if (doubleColonParts.length === 1) {
    return head.length === 8 ? head : null;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 1) {
    return null;
  }

  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function parseIpv6Part(part: string): number[] | null {
  if (part === "") {
    return [];
  }

  const pieces = part.split(":");
  const hextets: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1) {
        return null;
      }

      const octets = parseStrictIpv4Host(piece);
      if (!octets) {
        return null;
      }

      hextets.push((octets[0] << 8) + octets[1], (octets[2] << 8) + octets[3]);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(piece)) {
      return null;
    }

    hextets.push(Number.parseInt(piece, 16));
  }

  return hextets;
}

function isUnsafeIpv4Host(host: string): boolean {
  const octets = parseStrictIpv4Host(host);
  return octets ? isUnsafeIpv4Octets(octets) : true;
}

function isUnsafeIpv4Octets(octets: number[]): boolean {
  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeIpv6Host(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) {
    return false;
  }

  if (
    hextets.every((hextet) => hextet === 0) ||
    (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1)
  ) {
    return true;
  }

  const firstHextet = hextets[0];
  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}
