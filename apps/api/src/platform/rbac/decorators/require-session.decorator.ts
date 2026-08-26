import { SetMetadata } from "@nestjs/common";

import { RBAC_METADATA_KEY, type RbacMetadata } from "./rbac-metadata.js";

/**
 * Requires an authenticated session without evaluating a specific RBAC role.
 *
 * @returns A Nest class/method decorator containing session-only RBAC metadata.
 */
export const RequireSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, RbacMetadata>(RBAC_METADATA_KEY, {
    type: "session",
  });
