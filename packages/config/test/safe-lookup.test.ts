import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { OutboundPolicy } from "../src/network-security.js";
import { createSafeLookup } from "../src/safe-lookup.js";

describe("createSafeLookup", () => {
  it("forces all-answer verbatim resolution while preserving family and hints", async () => {
    const resolver = vi.fn<LookupFunction>((_hostname, options, callback) => {
      callback(null, [{ address: "8.8.8.8", family: 4 }], 4);
    });
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "example.com", { family: 4, hints: 32 })).resolves.toEqual({
      address: "8.8.8.8",
      family: 4
    });
    expect(resolver).toHaveBeenCalledWith(
      "example.com",
      { family: 4, hints: 32, all: true, verbatim: true },
      expect.any(Function)
    );
  });

  it("rejects a mixed public/private answer set before returning a socket target", async () => {
    const resolver = resolverReturning([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.7", family: 4 }
    ]);
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "rebind.example")).rejects.toThrow("outbound_address_forbidden");
  });

  it("rejects an unsafe sibling even when the caller requests a different family", async () => {
    const resolver = resolverReturning([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "127.0.0.1", family: 4 }
    ]);
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "rebind.example", { family: 6 })).rejects.toThrow(
      "outbound_address_forbidden"
    );
  });

  it("rejects a resolver answer outside the requested family", async () => {
    const lookup = createSafeLookup(
      new OutboundPolicy(),
      resolverReturning([{ address: "2606:4700:4700::1111", family: 6 }])
    );

    await expect(runLookup(lookup, "example.com", { family: 4 })).rejects.toThrow(
      "outbound_lookup_failed"
    );
  });

  it.each(["127.0.0.1", "::ffff:127.0.0.1", "64:ff9b::10.0.0.1", "2002:7f00:0001::1"])(
    "applies the policy to a directly supplied literal %s",
    async (hostname) => {
      const lookup = createSafeLookup(
        new OutboundPolicy(),
        resolverReturning([{ address: hostname, family: hostname.includes(":") ? 6 : 4 }])
      );
      await expect(runLookup(lookup, hostname)).rejects.toThrow("outbound_address_forbidden");
    }
  );

  it("rejects an unsafe literal before a misbehaving resolver can substitute a public answer", async () => {
    const resolver = resolverReturning([{ address: "8.8.8.8", family: 4 }]);
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "127.0.0.1")).rejects.toThrow("outbound_address_forbidden");
  });

  it.each(["100:0:0:1::1", "0100:0000:0000:0001:0000:0000:0000:0001"])(
    "rejects an RFC 9780 Dummy Prefix resolver answer %s",
    async (address) => {
      const lookup = createSafeLookup(
        new OutboundPolicy(),
        resolverReturning([{ address, family: 6 }])
      );

      await expect(runLookup(lookup, "dummy-prefix.example")).rejects.toThrow(
        "outbound_address_forbidden"
      );
    }
  );

  it("returns all validated answers for the all-address overload", async () => {
    const answers = [
      { address: "8.8.8.8", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const }
    ];
    const lookup = createSafeLookup(new OutboundPolicy(), resolverReturning(answers));

    await expect(runLookupAll(lookup, "example.com")).resolves.toEqual(answers);
  });

  it("returns the first validated answer for the single-address overload", async () => {
    const lookup = createSafeLookup(
      new OutboundPolicy(),
      resolverReturning([
        { address: "8.8.8.8", family: 4 },
        { address: "1.1.1.1", family: 4 }
      ])
    );

    await expect(runLookup(lookup, "example.com")).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });

  it.each([
    { answers: [] },
    { answers: [{ address: "not-an-ip", family: 4 }] },
    { answers: [{ address: "8.8.8.8", family: 6 }] },
    { answers: [{ address: "8.8.8.8", family: 0 }] },
    { answers: [{ address: "", family: 4 }] }
  ] as Array<{ answers: LookupAddress[] }>)("fails closed for an empty or malformed resolver result %#", async ({ answers }) => {
    const lookup = createSafeLookup(new OutboundPolicy(), resolverReturning(answers));
    await expect(runLookup(lookup, "example.com")).rejects.toThrow("outbound_lookup_failed");
  });

  it("sanitizes resolver failures and does not retry through an unvalidated path", async () => {
    const resolver = vi.fn<LookupFunction>((_hostname, _options, callback) => {
      callback(new Error("getaddrinfo failed for secret.internal"), "", 0);
    });
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "secret.internal")).rejects.toThrow("outbound_lookup_failed");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("retains only coarse retryability for transient resolver failures", async () => {
    const resolver = vi.fn<LookupFunction>((_hostname, _options, callback) => {
      callback(Object.assign(new Error("temporary lookup for secret.internal"), { code: "EAI_AGAIN" }), "", 0);
    });
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    const error = await runLookup(lookup, "secret.internal").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "outbound_lookup_failed", code: "EAI_FAIL" });
    expect((error as { retryable?: unknown }).retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain("secret.internal");
  });

  it("does not mark permanent, malformed, or address-policy lookup failures retryable", async () => {
    const permanent = createSafeLookup(new OutboundPolicy(), (_hostname, _options, callback) => {
      callback(Object.assign(new Error("permanent secret"), { code: "ENOTFOUND" }), "", 0);
    });
    const malformed = createSafeLookup(new OutboundPolicy(), resolverReturning([]));
    const forbidden = createSafeLookup(
      new OutboundPolicy(),
      resolverReturning([{ address: "127.0.0.1", family: 4 }])
    );

    for (const operation of [
      runLookup(permanent, "secret.internal"),
      runLookup(malformed, "secret.internal"),
      runLookup(forbidden, "secret.internal")
    ]) {
      const error = await operation.catch((caught: unknown) => caught);
      expect((error as { retryable?: unknown }).retryable).not.toBe(true);
    }
  });

  it.each([
    { label: "null", answers: [null] },
    { label: "undefined", answers: [undefined] },
    { label: "sparse", answers: new Array(1) }
  ])("sanitizes a $label resolver entry", async ({ answers }) => {
    const lookup = createSafeLookup(
      new OutboundPolicy(),
      resolverReturning(answers as unknown as LookupAddress[])
    );

    await expect(runLookup(lookup, "example.com")).rejects.toThrow("outbound_lookup_failed");
  });

  it("sanitizes a synchronous resolver exception", async () => {
    const resolver = vi.fn<LookupFunction>(() => {
      throw new Error("resolver failed for secret.internal");
    });
    const lookup = createSafeLookup(new OutboundPolicy(), resolver);

    await expect(runLookup(lookup, "secret.internal")).rejects.toThrow("outbound_lookup_failed");
  });

  it("honors an explicitly allowed private answer", async () => {
    const lookup = createSafeLookup(
      new OutboundPolicy({ privateCidrs: ["10.20.0.0/16"] }),
      resolverReturning([{ address: "10.20.3.4", family: 4 }])
    );

    await expect(runLookup(lookup, "warehouse.internal")).resolves.toEqual({
      address: "10.20.3.4",
      family: 4
    });
  });
});

function resolverReturning(answers: LookupAddress[]): LookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, answers, answers[0]?.family ?? 0);
  };
}

function runLookup(
  lookup: LookupFunction,
  hostname: string,
  options: { family?: number; hints?: number } = {}
): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { ...options, all: false }, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      if (Array.isArray(address)) {
        reject(new Error("expected a single address"));
        return;
      }
      if (family === undefined) {
        reject(new Error("expected an address family"));
        return;
      }
      resolve({ address, family });
    });
  });
}

function runLookupAll(lookup: LookupFunction, hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      if (!Array.isArray(addresses)) {
        reject(new Error("expected all addresses"));
        return;
      }
      resolve(addresses);
    });
  });
}
