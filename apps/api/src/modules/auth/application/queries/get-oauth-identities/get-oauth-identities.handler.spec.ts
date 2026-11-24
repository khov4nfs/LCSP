import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { OAuthIdentity } from "../../../domain/models/auth.models.ts";
import type { OAuthIdentityRepository } from "../../ports/persistence/oauth-identity.repository.ts";
import { GetOAuthIdentitiesHandler } from "./get-oauth-identities.handler.ts";
import { GetOAuthIdentitiesQuery } from "./get-oauth-identities.query.ts";

describe("GetOAuthIdentitiesHandler", () => {
  it("returns an empty list when user has no linked identities", async () => {
    const mockRepo: OAuthIdentityRepository = {
      findByProviderAccount:
        jest.fn<OAuthIdentityRepository["findByProviderAccount"]>(),
      findByUserId: jest
        .fn<OAuthIdentityRepository["findByUserId"]>()
        .mockResolvedValue([]),
      linkToUser: jest.fn<OAuthIdentityRepository["linkToUser"]>(),
    };

    const handler = new GetOAuthIdentitiesHandler(mockRepo);
    const result = await handler.execute(
      new GetOAuthIdentitiesQuery(
        {
          userId: "user-123",
          sessionId: "session-123",
          role: AUTH_USER_ROLES.customer,
        },
        "corr-1",
      ),
    );

    expect(result).toEqual({ identities: [] });
    expect(mockRepo.findByUserId).toHaveBeenCalledWith("user-123");
  });

  it("returns mapped identity summaries with ISO linked_at timestamp", async () => {
    const fixedTime = 1732438800000; // 2024-11-24T09:00:00.000Z
    const identity = OAuthIdentity.rehydrate({
      id: "ident-1",
      userId: "user-456",
      provider: "google",
      providerAccountId: "google-sub-1",
      createdAt: fixedTime,
    });

    const mockRepo: OAuthIdentityRepository = {
      findByProviderAccount:
        jest.fn<OAuthIdentityRepository["findByProviderAccount"]>(),
      findByUserId: jest
        .fn<OAuthIdentityRepository["findByUserId"]>()
        .mockResolvedValue([identity]),
      linkToUser: jest.fn<OAuthIdentityRepository["linkToUser"]>(),
    };

    const handler = new GetOAuthIdentitiesHandler(mockRepo);
    const result = await handler.execute(
      new GetOAuthIdentitiesQuery(
        {
          userId: "user-456",
          sessionId: "session-456",
          role: AUTH_USER_ROLES.customer,
        },
        "corr-2",
      ),
    );

    expect(result).toEqual({
      identities: [
        {
          id: "ident-1",
          provider: "google",
          linked_at: new Date(fixedTime).toISOString(),
        },
      ],
    });
  });
});
