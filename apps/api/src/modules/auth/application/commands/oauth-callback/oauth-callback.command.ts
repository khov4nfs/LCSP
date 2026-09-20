import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { OAuthCallbackPayload } from "../../contracts/auth/oauth.contract.ts";

export class OAuthCallbackCommand {
  readonly payload: OAuthCallbackPayload;
  readonly requestMeta: RequestMeta;

  constructor(payload: OAuthCallbackPayload, requestMeta: RequestMeta = {}) {
    this.payload = payload;
    this.requestMeta = requestMeta;
  }
}
