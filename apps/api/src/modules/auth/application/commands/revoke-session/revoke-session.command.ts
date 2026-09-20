import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class RevokeSessionCommand {
  readonly sessionToken: string;
  readonly requestMeta: RequestMeta;

  constructor(sessionToken: string, requestMeta: RequestMeta = {}) {
    this.sessionToken = sessionToken;
    this.requestMeta = requestMeta;
  }
}
