import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";
import type { RequestMeta } from "../../contracts/auth/common.contract.ts";

export class RevokeOwnedSessionCommand {
  constructor(
    public readonly sessionId: string,
    public readonly context: RbacRequestContext,
    public readonly requestMeta: RequestMeta = {},
  ) {}
}
