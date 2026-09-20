import type { RequestMeta } from "../../contracts/auth/common.contract.ts";
import type { CredentialPayload } from "../../contracts/auth/sign-in.contract.ts";

export class SignInCommand {
  readonly payload: CredentialPayload;
  readonly requestMeta: RequestMeta;

  constructor(payload: CredentialPayload, requestMeta: RequestMeta = {}) {
    this.payload = payload;
    this.requestMeta = requestMeta;
  }
}
