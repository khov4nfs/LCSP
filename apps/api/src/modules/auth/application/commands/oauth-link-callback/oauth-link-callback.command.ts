import type { OAuthLinkCallbackInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class OAuthLinkCallbackCommand {
  constructor(
    public readonly payload: OAuthLinkCallbackInput,
    public readonly userId: string,
    public readonly sessionId: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
