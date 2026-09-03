import argon2 from "argon2";

export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$71NxrotZdbQvDL89wu0gKw$ot+GuTIRsVsVagdXmHV9k6h9Dre8CysVSYba6xI5kas";

export type AuthLoginOutcome =
  | "success"
  | "invalid_credentials"
  | "source_rate_limited"
  | "account_rate_limited"
  | "auth_unavailable";

export function createAuthLoginTelemetry(outcome: AuthLoginOutcome) {
  return { auth: { operation: "login" as const, outcome } };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
