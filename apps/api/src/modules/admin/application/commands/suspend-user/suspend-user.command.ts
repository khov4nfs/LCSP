import type { AdminUserActionInput } from "@lcsp/contracts/auth";
import type { AdminActor } from "../../../infrastructure/persistence/admin-account.transaction.js";

export class SuspendUserCommand {
  constructor(
    public readonly targetId: string,
    public readonly body: AdminUserActionInput,
    public readonly actor: AdminActor,
  ) {}
}
