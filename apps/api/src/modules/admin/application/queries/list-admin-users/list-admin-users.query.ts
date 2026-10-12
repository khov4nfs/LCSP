import type { AdminListUsersQueryInput } from "@lcsp/contracts/auth";

export class ListAdminUsersQuery {
  constructor(
    public readonly params: AdminListUsersQueryInput,
    public readonly correlationId: string,
  ) {}
}
