import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { ConfirmRecoveryPayload } from "../../contracts/auth/recovery.contract.ts";

export class ConfirmPasswordRecoveryCommand {
  constructor(
    public readonly payload: ConfirmRecoveryPayload,
    public readonly requestMeta: RequestMeta,
  ) {}
}
