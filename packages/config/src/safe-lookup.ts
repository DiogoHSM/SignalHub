import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions, type LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { isAddressLiteral, type OutboundPolicy } from "./network-security.js";

export function createSafeLookup(policy: OutboundPolicy, lookup: LookupFunction = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    const requestedOptions = options ?? {};
    const resolverOptions: LookupAllOptions = {
      family: requestedOptions.family,
      hints: requestedOptions.hints,
      all: true,
      verbatim: true
    };

    if (isAddressLiteral(hostname)) {
      try {
        policy.assertAddress(hostname);
      } catch {
        callback(addressError(), "", 0);
        return;
      }
    }

    try {
      lookup(hostname, resolverOptions, (error, rawAddresses) => {
        if (error || !Array.isArray(rawAddresses) || rawAddresses.length === 0) {
          callback(lookupError(), "", 0);
          return;
        }

        const addresses: LookupAddress[] = [];
        for (const candidate of rawAddresses) {
          if (!isValidLookupAddress(candidate)) {
            callback(lookupError(), "", 0);
            return;
          }
          try {
            policy.assertAddress(candidate.address);
          } catch {
            callback(addressError(), "", 0);
            return;
          }
          addresses.push({ address: candidate.address, family: candidate.family });
        }

        const requestedFamily = normalizeFamily(requestedOptions.family);
        if (requestedFamily !== 0 && addresses.some((candidate) => candidate.family !== requestedFamily)) {
          callback(lookupError(), "", 0);
          return;
        }

        if ((requestedOptions as LookupOptions).all === true) {
          callback(null, addresses, addresses[0]?.family);
          return;
        }

        const first = addresses[0];
        if (!first) {
          callback(lookupError(), "", 0);
          return;
        }
        callback(null, first.address, first.family);
      });
    } catch {
      callback(lookupError(), "", 0);
    }
  };
}

function normalizeFamily(family: LookupOptions["family"]): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

function isValidLookupAddress(candidate: unknown): candidate is LookupAddress {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const value = candidate as Partial<LookupAddress>;
  if (typeof value.address !== "string" || typeof value.family !== "number") {
    return false;
  }
  const actualFamily = isIP(value.address);
  return (value.family === 4 || value.family === 6) && actualFamily === value.family;
}

function lookupError(): NodeJS.ErrnoException {
  return Object.assign(new Error("outbound_lookup_failed"), { code: "EAI_FAIL" });
}

function addressError(): NodeJS.ErrnoException {
  return Object.assign(new Error("outbound_address_forbidden"), { code: "EACCES" });
}
