import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_USER_ROLES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import * as crypto from "node:crypto";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "../../../infrastructure/persistence/auth-record.persistence.ts";
import {
  createCorrelationId,
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../infrastructure/security/security.utils.ts";
import type { SignUpResponse } from "../../contracts/auth-workspace/sign-up.contract.ts";
import { AuthAuditService } from "../../services/auth-workspace/auth-audit.service.ts";
import { SignUpCommand } from "./sign-up.command.ts";

const SESSION_TTL_MS = 8 * 60 * 60_000;
const MIN_PASSWORD_LENGTH = 12;
const MAX_DISPLAY_NAME_LENGTH = 100;

export class SignUpHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAudit: AuthAuditService,
  ) {}

  async execute(command: SignUpCommand): Promise<SignUpResponse> {
    const { email, displayName, password } = command.input;
    const correlationId = command.input.correlationId ?? createCorrelationId();

    if (!isValidEmail(email) || !isValidDisplayName(displayName)) {
      await this.recordFailure(
        correlationId,
        SIGN_UP_ERROR_CODES.invalidRequest,
      );
      throw problemException(
        SIGN_UP_ERROR_CODES.invalidRequest,
        correlationId,
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }

    if (!isNonEmptyString(password) || password.length < MIN_PASSWORD_LENGTH) {
      await this.recordFailure(
        correlationId,
        SIGN_UP_ERROR_CODES.passwordTooShort,
      );
      throw problemException(
        SIGN_UP_ERROR_CODES.passwordTooShort,
        correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedDisplayName = displayName.trim();
    const sessionToken = issueOpaqueToken();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const role = AUTH_USER_ROLES.customer;
    const newUserId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();
    const tokenFingerprint = fingerprintToken(sessionToken);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      await this.recordFailure(
        correlationId,
        SIGN_UP_ERROR_CODES.emailAlreadyExists,
      );
      throw problemException(
        SIGN_UP_ERROR_CODES.emailAlreadyExists,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    let userId = "";
    let sessionId = "";
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: newUserId,
            email: normalizedEmail,
            passwordHash: hashSecret(password),
            emailVerified: true,
            failedLoginCount: 0,
            lockUntil: null,
            displayName: trimmedDisplayName,
            role,
          },
        });
        userId = user.id;

        const session = await tx.authRecord.create({
          data: {
            id: newSessionId,
            userId,
            type: AUTH_RECORD_TYPES.session,
            lookupKey: authRecordLookupKey(
              AUTH_RECORD_TYPES.session,
              tokenFingerprint,
            ),
            secretHash: hashSecret(sessionToken),
            expiresAt: sessionExpiresAt,
            revokedAt: null,
            metadata: {
              tokenFingerprint,
              mfaVerifiedAt: null,
              sensitiveActionVerifiedAt: null,
            },
          },
        });
        sessionId = session.id;

        await this.authAudit.writeInTx(
          {
            eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
            actorId: userId,
            resourceType: AUDIT_RESOURCE_TYPES.authSession,
            resourceId: sessionId,
            decision: AUDIT_DECISIONS.allow,
            correlationId,
            sessionId,
            payload: {
              event_type: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
              actor_id: userId,
              decision: AUDIT_DECISIONS.allow,
              correlationId,
              session_id: sessionId,
              role,
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        await this.recordFailure(
          correlationId,
          SIGN_UP_ERROR_CODES.emailAlreadyExists,
        );
        throw problemException(
          SIGN_UP_ERROR_CODES.emailAlreadyExists,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      throw error;
    }

    return {
      user_id: userId,
      session_token: sessionToken,
      expires_at: sessionExpiresAt.toISOString(),
      correlationId,
    };
  }

  private recordFailure(correlationId: string, reasonCode: string) {
    return this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
      actorId: null,
      resourceType: AUDIT_RESOURCE_TYPES.authSession,
      resourceId: null,
      decision: AUDIT_DECISIONS.deny,
      correlationId,
      reasonCode,
      payload: {
        event_type: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
        decision: AUDIT_DECISIONS.deny,
        reason_code: reasonCode,
        correlationId,
      },
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value: unknown): value is string {
  return (
    isNonEmptyString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

function isValidDisplayName(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim().length >= 1 &&
    value.trim().length <= MAX_DISPLAY_NAME_LENGTH
  );
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
