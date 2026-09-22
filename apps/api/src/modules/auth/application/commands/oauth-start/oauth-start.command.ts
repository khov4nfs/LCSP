import type { OAuthStartInput } from "@lcsp/contracts/auth";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class OAuthStartCommand {
  constructor(
    public readonly payload: OAuthStartInput,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
