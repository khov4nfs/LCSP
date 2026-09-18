import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";

export class EnrollMfaCommand {
  constructor(
    public readonly userId: string,
    public readonly sessionId?: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
