import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { RequestRecoveryPayload } from "../../contracts/auth/recovery.contract.ts";

export class RequestPasswordRecoveryCommand {
  constructor(
    public readonly payload: RequestRecoveryPayload,
    public readonly requestMeta: RequestMeta,
  ) {}
}
