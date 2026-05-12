import { createHash, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

const apiKeyId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);
const sourceMapUploadTokenId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);

export type CreatedApiKey = {
  secret: string;
  prefix: string;
};

export function createApiKey(): CreatedApiKey {
  const secret = `sh_${apiKeyId()}`;
  return {
    secret,
    prefix: secret.slice(0, 12)
  };
}

export function createSourceMapUploadToken(): CreatedApiKey {
  const secret = `shsmap_${sourceMapUploadTokenId()}`;
  return {
    secret,
    prefix: secret.slice(0, 16)
  };
}

export async function hashApiKey(secret: string, pepper: string): Promise<string> {
  return createHash("sha256").update(`${pepper}:${secret}`).digest("hex");
}

export async function verifyApiKey(hash: string, secret: string, pepper: string): Promise<boolean> {
  const candidateHash = await hashApiKey(secret, pepper);
  const expected = Buffer.from(hash, "hex");
  const candidate = Buffer.from(candidateHash, "hex");

  if (expected.length !== candidate.length) {
    return false;
  }

  return timingSafeEqual(expected, candidate);
}
