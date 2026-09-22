import type { RequestPasswordRecoveryInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class RequestPasswordRecoveryCommand {
  constructor(
    public readonly payload: RequestPasswordRecoveryInput,
    public readonly requestMeta: RequestMeta,
  ) {}
}
