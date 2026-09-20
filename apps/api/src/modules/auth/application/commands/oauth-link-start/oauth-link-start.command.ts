import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { OAuthLinkStartPayload } from "../../contracts/auth/oauth.contract.ts";

export class OAuthLinkStartCommand {
  readonly payload: OAuthLinkStartPayload;
  readonly userId: string;
  readonly sessionId: string;
  readonly requestMeta: RequestMeta;

  constructor(
    payload: OAuthLinkStartPayload,
    userId: string,
    sessionId: string,
    requestMeta: RequestMeta = {},
  ) {
    this.payload = payload;
    this.userId = userId;
    this.sessionId = sessionId;
    this.requestMeta = requestMeta;
  }
}
