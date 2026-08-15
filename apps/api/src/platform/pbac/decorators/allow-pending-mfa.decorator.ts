import { SetMetadata } from "@nestjs/common";

export const ALLOW_PENDING_MFA_METADATA_KEY = "pbac:allow_pending_mfa";

/**
 * Marks a controller or route as accessible while the authenticated session is still pending MFA completion.
 *
 * @returns A Nest class/method decorator that sets the pending-MFA allowance metadata.
 */
export const AllowPendingMfa = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, true>(ALLOW_PENDING_MFA_METADATA_KEY, true);
