import type { RequiredAction } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { API_OUTCOME_KINDS } from "../outcome-kinds.ts";

export type MfaVerifyRequest = {
  otp: string;
};

export type MfaRecoveryCodeVerifyRequest = {
  code: string;
};

export type MfaVerifyError = {
  titleKey: MessageKey;
  detailKey: MessageKey;
  requiredAction?: RequiredAction;
};

export type MfaVerifyOutcome =
  | { kind: typeof API_OUTCOME_KINDS.verified }
  | { kind: typeof API_OUTCOME_KINDS.mfaRequired }
  | { kind: typeof API_OUTCOME_KINDS.sessionInvalid }
  | ({
      kind: typeof API_OUTCOME_KINDS.mfaEnrollmentExpired;
      requiredAction: RequiredAction;
    } & MfaVerifyError)
  | ({
      kind: typeof API_OUTCOME_KINDS.reauthRequired;
      requiredAction?: RequiredAction;
    } & MfaVerifyError)
  | ({
      kind: typeof API_OUTCOME_KINDS.invalid;
      requiredAction?: RequiredAction;
    } & MfaVerifyError)
  | ({ kind: typeof API_OUTCOME_KINDS.rateLimited } & MfaVerifyError)
  | ({ kind: typeof API_OUTCOME_KINDS.error } & MfaVerifyError);
