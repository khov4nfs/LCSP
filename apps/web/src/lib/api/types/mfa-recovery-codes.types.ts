import type { DisableMfaOutcome } from "../auth-client";
import { API_OUTCOME_KINDS } from "../outcome-kinds";

export type GenerateMfaRecoveryCodesOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; recoveryCodes: string[] }
  | Exclude<DisableMfaOutcome, { kind: typeof API_OUTCOME_KINDS.disabled }>;
