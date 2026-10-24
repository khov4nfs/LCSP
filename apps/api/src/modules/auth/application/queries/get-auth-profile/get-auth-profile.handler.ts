import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  AUTH_FAILURE_REASONS,
  authFailure,
} from "../../errors/auth-application.error.ts";
import type { AuthProfileSuccess } from "../../contracts/auth/settings.contract.ts";
import {
  AUTH_READ_REPOSITORY,
  type AuthReadRepository,
} from "../../ports/persistence/auth-read.repository.ts";
import { GetAuthProfileQuery } from "./get-auth-profile.query.ts";

/** Validates the read-model result; projection and ORM mapping stay in the adapter. */
@QueryHandler(GetAuthProfileQuery)
export class GetAuthProfileHandler implements IQueryHandler<GetAuthProfileQuery> {
  constructor(
    @Inject(AUTH_READ_REPOSITORY)
    private readonly reads: AuthReadRepository,
  ) {}

  async execute(query: GetAuthProfileQuery): Promise<AuthProfileSuccess> {
    const profile = await this.reads.getProfile(
      query.context.userId,
      query.context.sessionId,
      query.context.role,
    );

    if (!profile) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, query.correlationId, {
        reason: AUTH_FAILURE_REASONS.authenticationRequired,
      });
    }
    return profile;
  }
}
