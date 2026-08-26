import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";
import type { OAuthLinkCallbackPayload } from "../../contracts/auth-workspace/oauth.contract.ts";

export class OAuthLinkCallbackCommand {
  readonly payload: OAuthLinkCallbackPayload;
  readonly userId: string;
  readonly sessionId: string;
  readonly requestMeta: RequestMeta;

  constructor(
    payload: OAuthLinkCallbackPayload,
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
