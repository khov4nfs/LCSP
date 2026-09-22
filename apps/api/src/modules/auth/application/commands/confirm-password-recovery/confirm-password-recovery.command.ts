import type { ConfirmPasswordRecoveryInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class ConfirmPasswordRecoveryCommand {
  constructor(
    public readonly payload: ConfirmPasswordRecoveryInput,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
