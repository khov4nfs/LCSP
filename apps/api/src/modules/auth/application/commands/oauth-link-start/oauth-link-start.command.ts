import type { OAuthLinkStartInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class OAuthLinkStartCommand {
  constructor(
    public readonly payload: OAuthLinkStartInput,
    public readonly userId: string,
    public readonly sessionId: string,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
