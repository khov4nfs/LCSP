import type { UpdatePrivacySettingsInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

/**
 * Command for updating authenticated user privacy settings.
 *
 * Rationale (Why):
 * Encapsulates mutation intent for privacy preferences within a discrete CQRS command.
 *
 * Mechanism (How):
 * Carries partial update payload, verified user ID, session ID, and audit request metadata.
 *
 * Invariants (What):
 * Scoped strictly to the target userId; payload must adhere to updatePrivacySettingsSchema.
 */
export class UpdatePrivacySettingsCommand {
  readonly payload: UpdatePrivacySettingsInput;
  readonly userId: string;
  readonly sessionId?: string | null;
  readonly requestMeta: RequestMeta;

  constructor(
    payload: UpdatePrivacySettingsInput,
    userId: string,
    sessionId?: string | null,
    requestMeta: RequestMeta = {},
  ) {
    this.payload = payload;
    this.userId = userId;
    this.sessionId = sessionId;
    this.requestMeta = requestMeta;
  }
}
