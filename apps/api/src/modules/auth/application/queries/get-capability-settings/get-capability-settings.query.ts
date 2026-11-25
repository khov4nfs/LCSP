import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

/**
 * Query to retrieve effective runtime capability settings for the authenticated user.
 */
export class GetCapabilitySettingsQuery {
  constructor(
    public readonly context: RbacRequestContext,
    public readonly correlationId?: string,
  ) {}
}
