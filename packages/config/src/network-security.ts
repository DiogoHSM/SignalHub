import ipaddr from "ipaddr.js";

export type ResolvedAddress = { address: string; family: number };
export type OutboundAddressClass = "public" | "private" | "loopback" | "forbidden";

export type OutboundPolicyOptions = {
  privateCidrs?: string[];
  allowLoopback?: boolean;
  nodeEnv?: "development" | "test" | "production";
};

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6;
type ParsedCidr = [ParsedAddress, number];

const RFC1918_AND_ULA_CIDRS: ParsedCidr[] = [
  ipaddr.parseCIDR("10.0.0.0/8"),
  ipaddr.parseCIDR("172.16.0.0/12"),
  ipaddr.parseCIDR("192.168.0.0/16"),
  ipaddr.parseCIDR("fc00::/7")
];
const ALWAYS_FORBIDDEN_IPV6_CIDRS: ParsedCidr[] = [
  ipaddr.parseCIDR("100:0:0:1::/64"),
  ipaddr.parseCIDR("3ffe::/16")
];

export class OutboundPolicy {
  private readonly privateCidrs: ParsedCidr[];
  private readonly allowLoopback: boolean;

  constructor(options: OutboundPolicyOptions = {}) {
    if (options.nodeEnv === "production" && options.allowLoopback === true) {
      throw new Error("outbound_loopback_production_forbidden");
    }
    if (
      options.allowLoopback === true &&
      options.nodeEnv !== "development" &&
      options.nodeEnv !== "test"
    ) {
      throw new Error("outbound_loopback_environment_required");
    }

    this.privateCidrs = (options.privateCidrs ?? []).map(parsePrivateCidr);
    this.allowLoopback = options.allowLoopback === true;
  }

  classifyAddress(address: string): OutboundAddressClass {
    return classifyAddress(address);
  }

  assertAddress(address: string): string {
    const parsed = parseAddress(address);
    if (!parsed) {
      throw new Error("outbound_address_forbidden");
    }

    const effectiveAddress = effectiveAddressForPolicy(parsed);
    const classification = classifyParsedAddress(effectiveAddress);
    if (classification === "public") {
      return address;
    }
    if (classification === "loopback" && this.allowLoopback) {
      return address;
    }
    if (
      classification === "private" &&
      this.privateCidrs.some(
        ([network, prefixLength]) =>
          network.kind() === effectiveAddress.kind() && effectiveAddress.match(network, prefixLength)
      )
    ) {
      return address;
    }

    throw new Error("outbound_address_forbidden");
  }

  validateOutboundUrl(rawUrl: string): URL {
    return validateOutboundUrl(rawUrl, this);
  }

  allowsLoopback(): boolean {
    return this.allowLoopback;
  }
}

export function classifyAddress(rawAddress: string): OutboundAddressClass {
  const parsed = parseAddress(rawAddress);
  return parsed ? classifyParsedAddress(effectiveAddressForPolicy(parsed)) : "forbidden";
}

export function validateOutboundUrl(rawUrl: string, policy: OutboundPolicy = new OutboundPolicy()): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("outbound_url_invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("outbound_protocol_forbidden");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("outbound_credentials_forbidden");
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    if (!policy.allowsLoopback()) {
      throw new Error("outbound_address_forbidden");
    }
    return url;
  }

  if (parseAddress(hostname)) {
    policy.assertAddress(hostname);
  }

  return url;
}

export function validateOutboundHttpTransport(
  rawUrl: string,
  policy: OutboundPolicy,
  options: { requireHttps?: boolean } = {}
): URL {
  const url = policy.validateOutboundUrl(rawUrl);
  if (options.requireHttps === true && url.protocol !== "https:" && !isExplicitLoopbackUrl(url, policy)) {
    throw new Error("outbound_https_required");
  }
  return url;
}

export function isExplicitLoopbackUrl(url: URL, policy: OutboundPolicy): boolean {
  if (!policy.allowsLoopback()) return false;
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return classifyAddress(hostname) === "loopback";
}

export function parseOutboundPrivateCidrs(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error("outbound_private_cidr_invalid");
  }

  for (const entry of entries) {
    parsePrivateCidr(entry);
  }
  return entries;
}

function parsePrivateCidr(rawCidr: string): ParsedCidr {
  const slashIndex = rawCidr.lastIndexOf("/");
  if (slashIndex <= 0 || slashIndex === rawCidr.length - 1 || rawCidr.includes("%")) {
    throw new Error("outbound_private_cidr_invalid");
  }

  const rawAddress = rawCidr.slice(0, slashIndex);
  let cidr: ParsedCidr;
  try {
    if (rawAddress.includes(":")) {
      if (!ipaddr.IPv6.isValidCIDR(rawCidr)) {
        throw new Error("invalid");
      }
      cidr = ipaddr.IPv6.parseCIDR(rawCidr);
    } else {
      if (!isStrictIpv4(rawAddress) || !ipaddr.IPv4.isValidCIDRFourPartDecimal(rawCidr)) {
        throw new Error("invalid");
      }
      cidr = ipaddr.IPv4.parseCIDR(rawCidr);
    }
  } catch {
    throw new Error("outbound_private_cidr_invalid");
  }

  const [address, prefixLength] = cidr;
  const canonicalNetwork =
    address.kind() === "ipv4"
      ? ipaddr.IPv4.networkAddressFromCIDR(rawCidr)
      : ipaddr.IPv6.networkAddressFromCIDR(rawCidr);
  if (canonicalNetwork.toString() !== address.toString()) {
    throw new Error("outbound_private_cidr_invalid");
  }

  const containedByPrivateRange = RFC1918_AND_ULA_CIDRS.some(([privateNetwork, privatePrefix]) => {
    return (
      privateNetwork.kind() === address.kind() &&
      prefixLength >= privatePrefix &&
      address.match(privateNetwork, privatePrefix)
    );
  });
  if (!containedByPrivateRange) {
    throw new Error("outbound_private_cidr_invalid");
  }

  return cidr;
}

function parseAddress(rawAddress: string): ParsedAddress | null {
  const address = stripIpv6Brackets(rawAddress);
  if (address.length === 0 || address.includes("%")) {
    return null;
  }

  if (!address.includes(":")) {
    if (!isStrictIpv4(address)) {
      return null;
    }
    return ipaddr.IPv4.parse(address);
  }

  if (!ipaddr.IPv6.isValid(address)) {
    return null;
  }
  try {
    return ipaddr.IPv6.parse(address);
  } catch {
    return null;
  }
}

function isStrictIpv4(address: string): boolean {
  const octets = address.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

export function isAddressLiteral(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname);
  return host.includes(":") || /^[0-9.]+$/.test(host) || ipaddr.isValid(host);
}

function stripIpv6Brackets(address: string): string {
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}

function effectiveAddressForPolicy(address: ParsedAddress): ParsedAddress {
  if (address.kind() === "ipv4") {
    return address;
  }

  const parts = (address as ipaddr.IPv6).parts;
  if (isIpv4Mapped(parts) || isIpv4Compatible(parts) || isRfc6145(parts) || isNat64WellKnown(parts)) {
    return ipv4FromWords(parts[6] ?? 0, parts[7] ?? 0);
  }
  if (parts[0] === 0x2002) {
    return ipv4FromWords(parts[1] ?? 0, parts[2] ?? 0);
  }

  return address;
}

function isIpv4Mapped(parts: number[]): boolean {
  return parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
}

function isIpv4Compatible(parts: number[]): boolean {
  return parts.slice(0, 6).every((part) => part === 0) && (parts[6] !== 0 || (parts[7] ?? 0) > 1);
}

function isRfc6145(parts: number[]): boolean {
  return parts.slice(0, 4).every((part) => part === 0) && parts[4] === 0xffff && parts[5] === 0;
}

function isNat64WellKnown(parts: number[]): boolean {
  return parts[0] === 0x64 && parts[1] === 0xff9b && parts.slice(2, 6).every((part) => part === 0);
}

function ipv4FromWords(high: number, low: number): ipaddr.IPv4 {
  return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

function classifyParsedAddress(address: ParsedAddress): OutboundAddressClass {
  if (
    ALWAYS_FORBIDDEN_IPV6_CIDRS.some(
      ([network, prefixLength]) => network.kind() === address.kind() && address.match(network, prefixLength)
    )
  ) {
    return "forbidden";
  }
  const range = address.range();
  if (range === "unicast") {
    return "public";
  }
  if (range === "loopback") {
    return "loopback";
  }
  if (range === "private" || range === "uniqueLocal") {
    return "private";
  }
  return "forbidden";
}

// Compatibility aliases for Task 4's current webhook and monitor consumers. They
// delegate to the same public-only policy and keep the existing user-facing errors.
const webhookCompatibilityPolicy = new OutboundPolicy();

export function validateWebhookTargetUrl(rawUrl: string): URL {
  try {
    return webhookCompatibilityPolicy.validateOutboundUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "outbound_url_invalid") throw new Error("invalid webhook URL");
    if (message === "outbound_protocol_forbidden") throw new Error("webhook URL must use http or https");
    if (message === "outbound_credentials_forbidden") throw new Error("webhook URL credentials are not allowed");
    throw new Error("unsafe webhook target");
  }
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
  const host = stripIpv6Brackets(rawHost).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (!isAddressLiteral(host)) {
    return false;
  }
  try {
    webhookCompatibilityPolicy.assertAddress(host);
    return false;
  } catch {
    return true;
  }
}
