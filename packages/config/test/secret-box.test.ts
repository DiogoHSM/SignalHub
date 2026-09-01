import { describe, expect, it } from "vitest";
import { SecretBox, type SecretBoxContext } from "../src/index.js";

const CURRENT_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const PREVIOUS_KEY = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const CURRENT_KEY_ID = "72cd6e8422c4";
const PREVIOUS_KEY_ID = "75877bb41d39";
const CONTEXT = {
  table: "warehouse_destinations",
  rowId: "wh_1",
  field: "connection_url"
};

function replaceEnvelopePart(envelope: string, index: number, value: string): string {
  const parts = envelope.split(".");
  parts[index] = value;
  return parts.join(".");
}

function changeFirstBase64UrlCharacter(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

function thrownMessage(operation: () => unknown): string {
  try {
    operation();
    throw new Error("expected_operation_to_throw");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function singleReadContext(): { context: SecretBoxContext; reads: Record<keyof SecretBoxContext, number> } {
  const reads = { table: 0, rowId: 0, field: 0 };
  const context = {} as SecretBoxContext;

  for (const name of ["table", "rowId", "field"] as const) {
    Object.defineProperty(context, name, {
      enumerable: true,
      get() {
        reads[name] += 1;
        if (reads[name] > 1) {
          throw new Error(`context_${name}_read_more_than_once`);
        }
        return CONTEXT[name];
      }
    });
  }

  return { context, reads };
}

describe("SecretBox", () => {
  it("decrypts an independently generated AES-256-GCM known-answer envelope", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope =
      "v1.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.y8nmUkeMYwrERci3RQq6xto";

    expect(box.decrypt(envelope, CONTEXT)).toBe("postgres://secret");
  });

  it.each([
    ["empty plaintext", "", CONTEXT],
    [
      "Unicode plaintext and context",
      "pässwörd-🔐-秘密",
      { table: "notificações", rowId: "linha-🔐", field: "cabeçalho_secreto" }
    ]
  ])("round-trips %s", (_label, plaintext, context) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    expect(box.decrypt(box.encrypt(plaintext, context), context)).toBe(plaintext);
  });

  it("uses a fresh random nonce for every encryption", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    const first = box.encrypt("postgres://secret", CONTEXT);
    const second = box.encrypt("postgres://secret", CONTEXT);

    expect(first).not.toBe(second);
    expect(first.split(".")[1]).toBe(CURRENT_KEY_ID);
    expect(second.split(".")[1]).toBe(CURRENT_KEY_ID);
  });

  it.each([
    ["nonce", 2],
    ["authentication tag", 3],
    ["ciphertext", 4]
  ])("rejects a modified %s", (_label, index) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);
    const parts = envelope.split(".");
    const modified = replaceEnvelopePart(envelope, index, changeFirstBase64UrlCharacter(parts[index]!));

    expect(() => box.decrypt(modified, CONTEXT)).toThrow("secret_authentication_failed");
  });

  it.each([
    ["table", { ...CONTEXT, table: "notification_channels" }],
    ["row ID", { ...CONTEXT, rowId: "wh_2" }],
    ["field", { ...CONTEXT, field: "secret_header_value" }]
  ])("binds the ciphertext to its %s AAD component", (_label, wrongContext) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);

    expect(() => box.decrypt(envelope, wrongContext)).toThrow("secret_authentication_failed");
  });

  it.each(["table", "rowId", "field"] as const)("rejects a NUL delimiter in the %s context component", (name) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    expect(() => box.encrypt("postgres://secret", { ...CONTEXT, [name]: `${CONTEXT[name]}\0suffix` })).toThrow(
      "secret_context_invalid"
    );
  });

  it.each([
    ["high", "table", "\uD800"],
    ["low", "table", "\uDC00"],
    ["high", "rowId", "\uD801"],
    ["low", "rowId", "\uDC01"],
    ["high", "field", "\uDBFF"],
    ["low", "field", "\uDFFF"]
  ] as const)("rejects a lone %s surrogate in the %s context during encryption", (_kind, name, value) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    expect(thrownMessage(() => box.encrypt("postgres://secret", { ...CONTEXT, [name]: value }))).toBe(
      "secret_context_invalid"
    );
  });

  it.each([
    ["high", "table", "\uD800"],
    ["low", "table", "\uDC00"],
    ["high", "rowId", "\uD801"],
    ["low", "rowId", "\uDC01"],
    ["high", "field", "\uDBFF"],
    ["low", "field", "\uDFFF"]
  ] as const)("rejects a lone %s surrogate in the %s context during decryption", (_kind, name, value) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);

    expect(thrownMessage(() => box.decrypt(envelope, { ...CONTEXT, [name]: value }))).toBe(
      "secret_context_invalid"
    );
  });

  it.each([
    ["high", "\uD800"],
    ["distinct high", "\uD801"],
    ["low", "\uDC00"],
    ["distinct low", "\uDC01"]
  ])("rejects plaintext containing a lone %s surrogate", (_kind, value) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    expect(thrownMessage(() => box.encrypt(`prefix-${value}-suffix`, CONTEXT))).toBe("secret_plaintext_invalid");
  });

  it("captures validated context components once during encryption", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const { context, reads } = singleReadContext();

    const envelope = box.encrypt("postgres://secret", context);

    expect(reads).toEqual({ table: 1, rowId: 1, field: 1 });
    expect(box.decrypt(envelope, CONTEXT)).toBe("postgres://secret");
  });

  it("captures validated context components once during decryption", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);
    const { context, reads } = singleReadContext();

    expect(box.decrypt(envelope, context)).toBe("postgres://secret");
    expect(reads).toEqual({ table: 1, rowId: 1, field: 1 });
  });

  it("rejects unsupported versions without exposing envelope details", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);

    expect(thrownMessage(() => box.decrypt(replaceEnvelopePart(envelope, 0, "v2"), CONTEXT))).toBe(
      "secret_version_unsupported"
    );
  });

  it.each([
    ["missing component", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA"],
    ["extra component", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.payload.extra"],
    ["invalid key ID", "v1.NOT-A-KEY-ID.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["noncanonical padded nonce", "v1.72cd6e8422c4.AAECAwQFBgcICQoL=.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["noncanonical padded tag", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA=.payload"],
    ["noncanonical padded ciphertext", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.cGF5bG9hZA=="],
    ["invalid base64url alphabet", "v1.72cd6e8422c4.AAECAwQFBgcICQo+.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["short nonce", "v1.72cd6e8422c4.AAECAwQFBgcICQ.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["long nonce", "v1.72cd6e8422c4.AAECAwQFBgcICQoLDA.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["short tag", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.AAECAwQFBgcICQoLDA0O.payload"],
    ["long tag", "v1.72cd6e8422c4.AAECAwQFBgcICQoL.AAECAwQFBgcICQoLDA0ODxA.payload"]
  ])("rejects a malformed envelope with a safe error: %s", (_label, envelope) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });

    expect(thrownMessage(() => box.decrypt(envelope, CONTEXT))).toBe("secret_envelope_invalid");
  });

  it("rejects an unknown key ID without exposing configured keys", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY, previousKey: PREVIOUS_KEY });
    const envelope = box.encrypt("postgres://secret", CONTEXT);
    const unknownKeyEnvelope = replaceEnvelopePart(envelope, 1, "000000000000");

    expect(thrownMessage(() => box.decrypt(unknownKeyEnvelope, CONTEXT))).toBe("secret_key_unknown");
  });

  it("reads previous-key ciphertext and identifies it for rotation", () => {
    const oldBox = new SecretBox({ currentKey: PREVIOUS_KEY });
    const previousEnvelope = oldBox.encrypt("postgres://legacy-secret", CONTEXT);
    const rotatingBox = new SecretBox({ currentKey: CURRENT_KEY, previousKey: PREVIOUS_KEY });

    expect(previousEnvelope.split(".")[1]).toBe(PREVIOUS_KEY_ID);
    expect(rotatingBox.decrypt(previousEnvelope, CONTEXT)).toBe("postgres://legacy-secret");
    expect(rotatingBox.needsRotation(previousEnvelope)).toBe(true);
  });

  it("writes with the current key after reading a previous-key envelope", () => {
    const previousEnvelope = new SecretBox({ currentKey: PREVIOUS_KEY }).encrypt("legacy", CONTEXT);
    const rotatingBox = new SecretBox({ currentKey: CURRENT_KEY, previousKey: PREVIOUS_KEY });

    expect(rotatingBox.decrypt(previousEnvelope, CONTEXT)).toBe("legacy");
    const currentEnvelope = rotatingBox.encrypt("replacement", CONTEXT);

    expect(currentEnvelope.split(".")[1]).toBe(CURRENT_KEY_ID);
    expect(rotatingBox.needsRotation(currentEnvelope)).toBe(false);
  });

  it.each([
    ["malformed", "not-an-envelope"],
    ["unsupported", "v2.72cd6e8422c4.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.payload"],
    ["unknown key", "v1.000000000000.AAECAwQFBgcICQoL.BgEK3dtHg0t29UJ5EFN8tA.payload"]
  ])("does not treat a %s envelope as safely rotatable", (_label, envelope) => {
    const box = new SecretBox({ currentKey: CURRENT_KEY, previousKey: PREVIOUS_KEY });

    expect(box.needsRotation(envelope)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["invalid base64", "not-base64!"],
    ["noncanonical base64", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"],
    ["short", Buffer.alloc(31, 1).toString("base64")],
    ["long", Buffer.alloc(33, 1).toString("base64")]
  ])("rejects an %s current key", (_label, currentKey) => {
    expect(() => new SecretBox({ currentKey })).toThrow("DATA_ENCRYPTION_KEY_invalid");
  });

  it("rejects equal current and previous key material", () => {
    expect(() => new SecretBox({ currentKey: CURRENT_KEY, previousKey: CURRENT_KEY })).toThrow(
      "DATA_ENCRYPTION_KEY_PREVIOUS_must_differ"
    );
  });

  it("never includes plaintext, key material, or ciphertext in authentication errors", () => {
    const box = new SecretBox({ currentKey: CURRENT_KEY });
    const plaintext = "sensitive-plaintext-marker";
    const envelope = box.encrypt(plaintext, CONTEXT);
    const message = thrownMessage(() => box.decrypt(envelope, { ...CONTEXT, rowId: "wrong" }));

    expect(message).toBe("secret_authentication_failed");
    expect(message).not.toContain(plaintext);
    expect(message).not.toContain(CURRENT_KEY);
    expect(message).not.toContain(envelope);
  });
});
