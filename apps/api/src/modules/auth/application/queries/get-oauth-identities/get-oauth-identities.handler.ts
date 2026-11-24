import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import type { LinkedIdentitiesSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  type OAuthIdentityRepository,
} from "../../ports/persistence/oauth-identity.repository.ts";
import { GetOAuthIdentitiesQuery } from "./get-oauth-identities.query.ts";

/**
 * Handles fetching linked third-party OAuth identities for the authenticated user.
 *
 * Enforces:
 * 1. Requires valid user ID and active session from context.
 * 2. Only retrieves OAuth identities owned by the authenticated user.
 * 3. Formats response to return safe identity summaries (id, provider, linked_at).
 */
@QueryHandler(GetOAuthIdentitiesQuery)
export class GetOAuthIdentitiesHandler implements IQueryHandler<GetOAuthIdentitiesQuery> {
  constructor(
    @Inject(AUTH_OAUTH_IDENTITY_REPOSITORY)
    private readonly oauthIdentities: OAuthIdentityRepository,
  ) {}

  /**
   * Business purpose: Retrieve all OAuth identities linked to the authenticated user's account.
   *
   * Business rules:
   * - Only reads identities where userId matches the caller's authenticated user ID.
   * - Returns safe representation with ISO-formatted linked_at timestamps.
   * - Never returns credentials, access tokens, refresh tokens, or provider account secrets.
   *
   * Execution flow:
   * 1. Extract userId from authenticated query context.
   * 2. Query repository for all OAuth identity records belonging to this user.
   * 3. Map identities into public summary objects and return wrapped in success shape.
   *
   * Failure cases:
   * - Persistence failures propagate as unhandled exceptions.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetOAuthIdentitiesQuery,
  ): Promise<LinkedIdentitiesSuccess> {
    const identities = await this.oauthIdentities.findByUserId(
      query.context.userId,
    );

    return {
      identities: identities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        linked_at: new Date(identity.createdAt).toISOString(),
      })),
    };
  }
}
