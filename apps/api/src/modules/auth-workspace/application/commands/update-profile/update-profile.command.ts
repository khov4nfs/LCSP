import type {
  AuthBackupEmailPolicy,
  AuthPrimaryEmailAddressPolicy,
} from "@lcsp/contracts/auth";

import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";

export type UpdateProfilePayload = {
  session_token?: string;
  display_name?: string;
  recovery_email?: string;
  primary_email_address_policy?: AuthPrimaryEmailAddressPolicy;
  backup_recovery_email_policy?: AuthBackupEmailPolicy;
};

export class UpdateProfileCommand {
  readonly payload: UpdateProfilePayload;
  readonly userId: string;
  readonly sessionId?: string | null;
  readonly requestMeta: RequestMeta;

  constructor(
    payload: UpdateProfilePayload,
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
