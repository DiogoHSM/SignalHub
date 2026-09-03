import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const requiredTimeoutDefaults: Record<string, string> = {
  ALERTS_WEBHOOK_TIMEOUT_MS: "5000",
  MONITORS_HTTP_TIMEOUT_MS: "5000",
  WAREHOUSE_CONNECTION_TIMEOUT_MS: "5000",
  WAREHOUSE_STATEMENT_TIMEOUT_MS: "30000",
  WAREHOUSE_LOCK_TIMEOUT_MS: "5000",
  WAREHOUSE_QUERY_TIMEOUT_MS: "35000",
  WAREHOUSE_TOTAL_TIMEOUT_MS: "60000"
};

function expectAll(content: string, required: string[]): void {
  for (const value of required) {
    expect(content, `missing documentation contract: ${value}`).toContain(value);
  }
}

describe("network security documentation contract", () => {
  it("keeps the operator guide aligned with the implemented deployment controls", () => {
    const content = read("docs/SELF-HOSTING.md");

    expectAll(content, [
      "TRUSTED_PROXY_CIDRS",
      "OUTBOUND_PRIVATE_CIDRS",
      "ALLOW_LOOPBACK_OUTBOUND",
      "right-to-left",
      "60 seconds",
      "1,000",
      "PER-507",
      "PER-508",
      "outbound_address_forbidden",
      "warehouse_destination_timeout"
    ]);
    for (const [name, value] of Object.entries(requiredTimeoutDefaults)) {
      expect(content).toContain("| `" + name + "` | `" + value + "` |");
    }
  });

  it("keeps the README overview explicit about proxy, CORS, DNS, and TLS boundaries", () => {
    const content = read("README.md");

    expectAll(content, [
      "TRUSTED_PROXY_CIDRS",
      "OUTBOUND_PRIVATE_CIDRS",
      "ALLOW_LOOPBACK_OUTBOUND",
      "right-to-left",
      "every DNS answer",
      "verified TLS",
      "60 seconds",
      "1,000"
    ]);
  });

  it("lists every operator-controlled network setting and its implemented default", () => {
    const content = read(".claude/docs/SECRETS.md");

    expectAll(content, ["TRUSTED_PROXY_CIDRS", "OUTBOUND_PRIVATE_CIDRS", "ALLOW_LOOPBACK_OUTBOUND"]);
    for (const [name, value] of Object.entries(requiredTimeoutDefaults)) {
      expect(content).toContain("| `" + name + "` | No | `" + value + "` |");
    }
  });
});
