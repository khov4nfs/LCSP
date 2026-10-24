import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
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
      throw problemException(
        AUTH_ERROR_CODES.sessionInvalid,
        query.correlationId,
        { status: HttpStatus.UNAUTHORIZED },
      );
    }
    return profile;
  }
}
