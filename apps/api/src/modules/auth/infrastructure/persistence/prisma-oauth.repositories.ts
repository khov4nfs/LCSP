import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OAuthIdentityRepository } from "../../application/ports/persistence/oauth-identity.repository.ts";
import type { OAuthStateRepository } from "../../application/ports/persistence/oauth-state.repository.ts";
import type {
  OAuthIdentity,
  OAuthState,
} from "../../domain/models/auth.models.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";
import {
  dateFromEpochMsRequired,
  mapOAuthIdentityRecord,
  mapOAuthStateRecord,
} from "./prisma-auth.mappers.ts";

@Injectable()
export class PrismaOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(state: OAuthState): Promise<void> {
    await this.prisma.authRecord.create({
      data: {
        id: state.id,
        userId: state.userId,
        type: AUTH_RECORD_TYPES.oauthState,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.oauthState,
          state.state,
        ),
        expiresAt: dateFromEpochMsRequired(state.expiresAt),
        metadata: {
          state: state.state,
          nonce: state.nonce,
          provider: state.provider,
          redirectUri: state.redirectUri,
          sessionId: state.sessionId,
        },
      },
    });
  }

  async consumeByState(state: string): Promise<OAuthState | null> {
    try {
      const record = await this.prisma.authRecord.delete({
        where: {
          lookupKey: authRecordLookupKey(AUTH_RECORD_TYPES.oauthState, state),
        },
      });
      return record.type === AUTH_RECORD_TYPES.oauthState
        ? mapOAuthStateRecord(record)
        : null;
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

@Injectable()
export class PrismaOAuthIdentityRepository implements OAuthIdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProviderAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<OAuthIdentity | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.oauthIdentity,
          provider,
          providerAccountId,
        ),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.oauthIdentity
      ? mapOAuthIdentityRecord(record)
      : null;
  }

  async linkToUser(
    provider: string,
    providerAccountId: string,
    userId: string,
  ): Promise<OAuthIdentity> {
    const lookupKey = authRecordLookupKey(
      AUTH_RECORD_TYPES.oauthIdentity,
      provider,
      providerAccountId,
    );
    const record = await this.prisma.authRecord.upsert({
      where: { lookupKey },
      create: {
        id: crypto.randomUUID(),
        userId,
        type: AUTH_RECORD_TYPES.oauthIdentity,
        lookupKey,
        metadata: { provider, providerAccountId },
      },
      update: {},
    });
    return mapOAuthIdentityRecord(record);
  }
}

function isRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
