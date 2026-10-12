import type { OAuthCallbackInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class OAuthCallbackCommand {
  constructor(
    public readonly payload: OAuthCallbackInput,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
