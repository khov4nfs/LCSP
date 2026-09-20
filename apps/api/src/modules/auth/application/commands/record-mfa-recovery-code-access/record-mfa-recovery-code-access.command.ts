import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { MfaRecoveryCodeAccessAction } from "../../contracts/auth/mfa.contract.ts";

export class RecordMfaRecoveryCodeAccessCommand {
  constructor(
    public readonly userId: string,
    public readonly action: MfaRecoveryCodeAccessAction,
    public readonly sessionId?: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
