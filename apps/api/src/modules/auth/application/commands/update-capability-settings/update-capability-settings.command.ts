import type { UpdateCapabilitySettingsInput } from "@lcsp/contracts/auth";

export type UpdateCapabilitySettingsRequestMeta = {
  correlationId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Command to update customer-configurable capability preferences for an authenticated user.
 */
export class UpdateCapabilitySettingsCommand {
  constructor(
    public readonly payload: UpdateCapabilitySettingsInput,
    public readonly userId: string,
    public readonly sessionId: string,
    public readonly requestMeta?: UpdateCapabilitySettingsRequestMeta,
  ) {}
}
