import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class VerifyMfaOtpCommand {
  constructor(
    public readonly sessionToken: string,
    public readonly otp: string,
    public readonly requestMeta: RequestMeta,
  ) {}
}
