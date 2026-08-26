import { SetMetadata } from "@nestjs/common";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import { RBAC_METADATA_KEY, type RbacMetadata } from "./rbac-metadata.js";

/**
 * Requires the authenticated user to have at least one of the specified roles.
 *
 * @param roles - The user roles that are allowed to access this endpoint.
 * @returns A Nest class/method decorator containing the required roles metadata.
 */
export const RequireRoles = (
  ...roles: readonly AuthUserRole[]
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, RbacMetadata>(RBAC_METADATA_KEY, {
    type: "roles",
    roles,
  });
