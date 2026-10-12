import type { UpdateProfileInput } from "@lcsp/contracts/auth";

import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class UpdateProfileCommand {
  readonly payload: UpdateProfileInput;
  readonly userId: string;
  readonly sessionId?: string | null;
  readonly requestMeta: RequestMeta;

  constructor(
    payload: UpdateProfileInput,
    userId: string,
    sessionId?: string | null,
    requestMeta: RequestMeta = {},
  ) {
    this.payload = payload;
    this.userId = userId;
    this.sessionId = sessionId;
    this.requestMeta = requestMeta;
  }
}
