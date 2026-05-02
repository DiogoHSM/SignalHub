import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";

const apiKeyId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);

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

export async function hashApiKey(secret: string, pepper: string): Promise<string> {
  return createHash("sha256").update(`${pepper}:${secret}`).digest("hex");
}

export async function verifyApiKey(hash: string, secret: string, pepper: string): Promise<boolean> {
  const candidate = await hashApiKey(secret, pepper);
  return candidate === hash;
}
