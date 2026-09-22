import type { SignInInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class SignInCommand {
  readonly payload: SignInInput;
  readonly requestMeta: RequestMeta;

  constructor(payload: SignInInput, requestMeta: RequestMeta = {}) {
    this.payload = payload;
    this.requestMeta = requestMeta;
  }
}
