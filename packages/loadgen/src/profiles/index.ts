import type { Profile } from "../types.js";
import { ECOMMERCE_PROFILE } from "./ecommerce.js";
import { FINTECH_PROFILE } from "./fintech.js";
import { SAAS_B2B_PROFILE } from "./saas-b2b.js";

export const PROFILES: Record<string, Profile> = {
  ecommerce: ECOMMERCE_PROFILE,
  fintech: FINTECH_PROFILE,
  "saas-b2b": SAAS_B2B_PROFILE
};

export { ECOMMERCE_PROFILE, FINTECH_PROFILE, SAAS_B2B_PROFILE };
