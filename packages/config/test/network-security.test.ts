import { describe, expect, it } from "vitest";
import {
  OutboundPolicy,
  classifyAddress,
  validateOutboundUrl
} from "../src/network-security.js";

describe("outbound address policy", () => {
  const publicOnly = new OutboundPolicy();

  it.each([
    "0.0.0.0",
    "100.64.0.1",
    "169.254.169.254",
    "192.0.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "fe80::1",
    "ff02::1",
    "100::1",
    "2001:db8::1",
    "2001:2::1",
    "2001:10::1",
    "3ffe::1"
  ])("rejects always-forbidden address %s", (address) => {
    expect(classifyAddress(address)).toBe("forbidden");
    expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public unicast address %s",
    (address) => {
      expect(classifyAddress(address)).toBe("public");
      expect(publicOnly.assertAddress(address)).toBe(address);
    }
  );

  it.each([
    "100:0:0:1::",
    "100:0:0:1::1",
    "0100:0000:0000:0001:0000:0000:0000:0001",
    "100:0:0:1:ffff:ffff:ffff:ffff"
  ])("rejects RFC 9780 IPv6 Dummy Prefix address %s", (address) => {
    expect(classifyAddress(address)).toBe("forbidden");
    expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
  });

  it.each(["100:0:0:2::", "100:0:0:ffff::1"])(
    "does not broaden the IPv6 Dummy Prefix exclusion to adjacent address %s",
    (address) => {
      expect(classifyAddress(address)).toBe("public");
      expect(publicOnly.assertAddress(address)).toBe(address);
    }
  );

  it.each(["127.0.0.1", "127.255.255.254", "::1"])("requires loopback opt-in for %s", (address) => {
    expect(classifyAddress(address)).toBe("loopback");
    expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
    expect(
      new OutboundPolicy({ nodeEnv: "development", allowLoopback: true }).assertAddress(address)
    ).toBe(address);
  });

  it.each(["10.1.2.3", "172.16.2.3", "192.168.2.3", "fc00::1", "fd12:3456::1"])(
    "requires an exact private CIDR allowlist hit for %s",
    (address) => {
      expect(classifyAddress(address)).toBe("private");
      expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
    }
  );

  it("allows only private addresses inside an explicitly configured CIDR", () => {
    const policy = new OutboundPolicy({
      privateCidrs: ["10.20.0.0/16", "fd12:3456::/32"]
    });

    expect(policy.assertAddress("10.20.4.5")).toBe("10.20.4.5");
    expect(policy.assertAddress("fd12:3456::5")).toBe("fd12:3456::5");
    expect(() => policy.assertAddress("10.21.4.5")).toThrow("outbound_address_forbidden");
    expect(() => policy.assertAddress("fd12:3457::5")).toThrow("outbound_address_forbidden");
  });

  it.each([
    ["::ffff:10.1.2.3", "private"],
    ["0:0:0:0:0:ffff:0a01:0203", "private"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::10.1.2.3", "private"],
    ["0:0:0:0:0:0:0a01:0203", "private"],
    ["::127.0.0.1", "loopback"],
    ["::ffff:0:10.1.2.3", "private"],
    ["0:0:0:0:ffff:0:0a01:0203", "private"],
    ["64:ff9b::10.1.2.3", "private"],
    ["0064:ff9b:0:0:0:0:0a01:0203", "private"],
    ["64:ff9b::127.0.0.1", "loopback"],
    ["2002:0a01:0203::1", "private"],
    ["2002:7f00:0001:ffff::1", "loopback"],
    ["2002:0808:0808::1", "public"]
  ] as const)("classifies unambiguous embedded address %s as %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
    if (expected === "public") {
      expect(publicOnly.assertAddress(address)).toBe(address);
    } else {
      expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
    }
  });

  it("applies the IPv4 private allowlist to decoded transition addresses", () => {
    const policy = new OutboundPolicy({ privateCidrs: ["10.1.0.0/16"] });

    expect(policy.assertAddress("::ffff:10.1.2.3")).toBe("::ffff:10.1.2.3");
    expect(policy.assertAddress("64:ff9b::10.1.2.3")).toBe("64:ff9b::10.1.2.3");
    expect(policy.assertAddress("2002:0a01:0203::1")).toBe("2002:0a01:0203::1");
    expect(() => policy.assertAddress("64:ff9b::10.2.2.3")).toThrow("outbound_address_forbidden");
  });

  it.each([
    "64:ff9b:1::10.1.2.3",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:20::1",
    "fe80::1%eth0",
    "not-an-address",
    "01.2.3.4",
    "127.1",
    "0x7f000001",
    "2130706433"
  ])("fails closed for ambiguous or malformed address %s", (address) => {
    expect(classifyAddress(address)).toBe("forbidden");
    expect(() => publicOnly.assertAddress(address)).toThrow("outbound_address_forbidden");
  });
});

describe("outbound URL policy", () => {
  const policy = new OutboundPolicy();

  it.each(["ftp://example.com/file", "file:///etc/passwd", "data:text/plain,hello"])(
    "rejects unsupported protocol without disclosing the URL: %s",
    (rawUrl) => {
      expect(() => policy.validateOutboundUrl(rawUrl)).toThrow("outbound_protocol_forbidden");
      expect(captureMessage(() => policy.validateOutboundUrl(rawUrl))).not.toContain(rawUrl);
    }
  );

  it("rejects credentials without disclosing credentials or the URL", () => {
    const rawUrl = "https://admin:super-secret@example.com/private?token=secret";
    const message = captureMessage(() => validateOutboundUrl(rawUrl, policy));

    expect(message).toBe("outbound_credentials_forbidden");
    expect(message).not.toContain("admin");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("/private");
  });

  it.each([
    "http://127.1/internal",
    "http://0x7f000001/internal",
    "http://2130706433/internal",
    "http://012.0.0.1/internal",
    "http://[::ffff:127.0.0.1]/internal",
    "http://[64:ff9b::127.0.0.1]/internal"
  ])("normalizes and rejects an alternative private or loopback literal: %s", (rawUrl) => {
    expect(() => policy.validateOutboundUrl(rawUrl)).toThrow("outbound_address_forbidden");
  });

  it.each([
    "https://[100:0:0:1::1]/secret?token=x",
    "https://[0100:0000:0000:0001:0000:0000:0000:0001]/secret?token=x"
  ])("rejects an RFC 9780 Dummy Prefix URL literal without disclosing it: %s", (rawUrl) => {
    expect(captureMessage(() => policy.validateOutboundUrl(rawUrl))).toBe("outbound_address_forbidden");
  });

  it("allows a public hostname and public IPv4/IPv6 literals", () => {
    expect(policy.validateOutboundUrl("https://example.com/path?q=value").hostname).toBe("example.com");
    expect(policy.validateOutboundUrl("https://123.example.com/path").hostname).toBe("123.example.com");
    expect(policy.validateOutboundUrl("https://8.8.8.8/path").hostname).toBe("8.8.8.8");
    expect(policy.validateOutboundUrl("https://[2606:4700:4700::1111]/path").hostname).toBe(
      "[2606:4700:4700::1111]"
    );
  });

  it("allows explicit development loopback but never production loopback", () => {
    const development = new OutboundPolicy({ nodeEnv: "development", allowLoopback: true });
    expect(development.validateOutboundUrl("http://localhost:3000/hook").hostname).toBe("localhost");
    expect(development.validateOutboundUrl("http://127.0.0.1:3000/hook").hostname).toBe("127.0.0.1");
    expect(() => new OutboundPolicy({ nodeEnv: "production", allowLoopback: true })).toThrow(
      "outbound_loopback_production_forbidden"
    );
    expect(() => new OutboundPolicy({ allowLoopback: true })).toThrow(
      "outbound_loopback_environment_required"
    );
  });

  it("uses a stable invalid URL error", () => {
    expect(captureMessage(() => policy.validateOutboundUrl("https://[invalid/path?secret=yes"))).toBe(
      "outbound_url_invalid"
    );
  });
});

function captureMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected function to throw");
}
