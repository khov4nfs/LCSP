import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class GenerateMfaRecoveryCodesCommand {
  constructor(
    public readonly userId: string,
    public readonly sessionId?: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
