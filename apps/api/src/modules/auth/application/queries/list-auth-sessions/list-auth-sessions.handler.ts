import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import type { AuthSessionsSuccess } from "../../contracts/auth/settings.contract.ts";
import {
  AUTH_READ_REPOSITORY,
  type AuthReadRepository,
} from "../../ports/persistence/auth-read.repository.ts";
import { ListAuthSessionsQuery } from "./list-auth-sessions.query.ts";

@QueryHandler(ListAuthSessionsQuery)
export class ListAuthSessionsHandler implements IQueryHandler<ListAuthSessionsQuery> {
  constructor(
    @Inject(AUTH_READ_REPOSITORY)
    private readonly reads: AuthReadRepository,
  ) {}

  execute(query: ListAuthSessionsQuery): Promise<AuthSessionsSuccess> {
    return this.reads.listSessions(
      query.context.userId,
      query.context.sessionId,
    );
  }
}
