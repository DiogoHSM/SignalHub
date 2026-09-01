import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_HEX_CHARACTERS = 12;

export interface SecretBoxContext {
  table: string;
  rowId: string;
  field: string;
}

export interface SecretBoxKeyring {
  currentKey: string;
  previousKey?: string;
}

interface KeyEntry {
  id: string;
  bytes: Buffer;
}

interface ParsedEnvelope {
  keyId: string;
  nonce: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function decodeKey(value: string, name: "DATA_ENCRYPTION_KEY" | "DATA_ENCRYPTION_KEY_PREVIOUS"): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${name}_invalid`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== value) {
    throw new Error(`${name}_invalid`);
  }
  return decoded;
}

function keyEntry(bytes: Buffer): KeyEntry {
  return {
    id: createHash("sha256").update(bytes).digest("hex").slice(0, KEY_ID_HEX_CHARACTERS),
    bytes
  };
}

function decodeBase64Url(value: string, allowEmpty: boolean): Buffer {
  if ((!allowEmpty && value.length === 0) || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("secret_envelope_invalid");
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("secret_envelope_invalid");
  }
  return decoded;
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(".");
  if (parts.length !== 5) {
    throw new Error("secret_envelope_invalid");
  }

  const [version, keyId, nonceValue, tagValue, ciphertextValue] = parts;
  if (version !== VERSION) {
    throw new Error("secret_version_unsupported");
  }
  if (!keyId || !/^[0-9a-f]{12}$/.test(keyId)) {
    throw new Error("secret_envelope_invalid");
  }

  const nonce = decodeBase64Url(nonceValue!, false);
  const tag = decodeBase64Url(tagValue!, false);
  const ciphertext = decodeBase64Url(ciphertextValue!, true);
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("secret_envelope_invalid");
  }

  return { keyId, nonce, tag, ciphertext };
}

function associatedData(context: SecretBoxContext): Buffer {
  const components = [context.table, context.rowId, context.field];
  if (components.some((component) => typeof component !== "string" || component.includes("\0"))) {
    throw new Error("secret_context_invalid");
  }
  return Buffer.from(`${context.table}\0${context.rowId}\0${context.field}`, "utf8");
}

export class SecretBox {
  readonly #current: KeyEntry;
  readonly #previous: KeyEntry | undefined;
  readonly #keysById: ReadonlyMap<string, KeyEntry>;

  constructor(keyring: SecretBoxKeyring) {
    const currentBytes = decodeKey(keyring.currentKey, "DATA_ENCRYPTION_KEY");
    const previousBytes = keyring.previousKey
      ? decodeKey(keyring.previousKey, "DATA_ENCRYPTION_KEY_PREVIOUS")
      : undefined;
    if (previousBytes?.equals(currentBytes)) {
      throw new Error("DATA_ENCRYPTION_KEY_PREVIOUS_must_differ");
    }

    this.#current = keyEntry(currentBytes);
    this.#previous = previousBytes ? keyEntry(previousBytes) : undefined;
    this.#keysById = new Map(
      [this.#current, this.#previous].filter((entry): entry is KeyEntry => entry !== undefined).map((entry) => [
        entry.id,
        entry
      ])
    );
  }

  encrypt(plaintext: string, context: SecretBoxContext): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#current.bytes, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      this.#current.id,
      nonce.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url")
    ].join(".");
  }

  decrypt(envelope: string, context: SecretBoxContext): string {
    const parsed = parseEnvelope(envelope);
    const key = this.#keysById.get(parsed.keyId);
    if (!key) {
      throw new Error("secret_key_unknown");
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", key.bytes, parsed.nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(associatedData(context));
      decipher.setAuthTag(parsed.tag);
      return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("secret_authentication_failed");
    }
  }

  needsRotation(envelope: string): boolean {
    if (!this.#previous) {
      return false;
    }

    try {
      const parsed = parseEnvelope(envelope);
      return this.#keysById.has(parsed.keyId) && parsed.keyId === this.#previous.id;
    } catch {
      return false;
    }
  }
}
