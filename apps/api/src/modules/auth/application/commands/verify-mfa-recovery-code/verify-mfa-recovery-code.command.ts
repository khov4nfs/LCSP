import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class VerifyMfaRecoveryCodeCommand {
  constructor(
    public readonly sessionToken: string,
    public readonly code: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
