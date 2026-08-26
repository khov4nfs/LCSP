import type { AuthUserRole } from "@lcsp/contracts/auth";

export const RBAC_METADATA_KEY = "rbac:metadata";

export type RbacMetadata =
  { type: "session" } | { type: "roles"; roles: readonly AuthUserRole[] };
