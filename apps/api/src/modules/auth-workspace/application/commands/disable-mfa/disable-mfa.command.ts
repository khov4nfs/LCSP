import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";

export class DisableMfaCommand {
  constructor(
    readonly userId: string,
    readonly sessionId?: string,
    readonly requestMeta: RequestMeta = {},
  ) {}
}
