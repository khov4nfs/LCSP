import * as crypto from "node:crypto";

import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import {
  MANAGER_ONLY_ACTION_VALUES,
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import { HttpStatus } from "@nestjs/common";

import { toPrismaAuthMembershipStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
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
const MAX_ORGANIZATION_NAME_LENGTH = 120;
const SELF_SIGN_UP_POLICY_VERSION = "self-sign-up-v1";

const SELF_SIGN_UP_MANAGER_ACTIONS = [
  PBAC_ACTIONS.workspaceRead,
  PBAC_ACTIONS.assessmentRead,
  PBAC_ACTIONS.assessmentList,
  PBAC_ACTIONS.githubConnect,
  PBAC_ACTIONS.scanRead,
  PBAC_ACTIONS.scanTrigger,
  PBAC_ACTIONS.documentRead,
  PBAC_ACTIONS.documentGenerate,
  PBAC_ACTIONS.snapshotCreate,
  ...MANAGER_ONLY_ACTION_VALUES,
] as const;

export class SignUpHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAudit: AuthAuditService,
  ) {}

  async execute(command: SignUpCommand): Promise<SignUpResponse> {
    const { email, displayName, organizationName, password } = command.input;
    const correlationId = command.input.correlationId ?? createCorrelationId();

    if (
      !isValidEmail(email) ||
      !isValidDisplayName(displayName) ||
      !isValidOrganizationName(organizationName)
    ) {
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
    const trimmedOrganizationName = organizationName.trim();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const policyId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const sessionToken = issueOpaqueToken();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const allowedActions = uniqueActions(SELF_SIGN_UP_MANAGER_ACTIONS);

    const existingUser = await this.prisma.authUser.findUnique({
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

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.authOrganization.create({
          data: {
            id: organizationId,
            slug: organizationSlug(trimmedOrganizationName, organizationId),
            name: trimmedOrganizationName,
            mfaRequired: false,
          },
        });

        await tx.authPolicy.create({
          data: {
            id: policyId,
            version: SELF_SIGN_UP_POLICY_VERSION,
            actions: allowedActions,
            subjectRole: SUBJECT_ROLES.manager,
            stateGate: PBAC_STATE_GATES.membershipActive,
            organizationId,
          },
        });

        await tx.authUser.create({
          data: {
            id: userId,
            email: normalizedEmail,
            passwordHash: hashSecret(password),
            emailVerified: true,
            failedLoginCount: 0,
            lockUntil: null,
            displayName: trimmedDisplayName,
          },
        });

        await tx.authMembership.create({
          data: {
            id: membershipId,
            userId,
            organizationId,
            status: toPrismaAuthMembershipStatus(
              AUTH_MEMBERSHIP_STATUSES.active,
            ),
            subjectAttributes: { role: SUBJECT_ROLES.manager },
            policyId,
            policyVersion: SELF_SIGN_UP_POLICY_VERSION,
          },
        });

        await tx.authSession.create({
          data: {
            id: sessionId,
            userId,
            organizationId,
            tokenHash: hashSecret(sessionToken),
            tokenFingerprint: fingerprintToken(sessionToken),
            expiresAt: sessionExpiresAt,
            revokedAt: null,
          },
        });

        await this.authAudit.writeInTx(
          {
            eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
            actorId: userId,
            organizationId,
            resourceType: AUDIT_RESOURCE_TYPES.workspace,
            resourceId: organizationId,
            decision: AUDIT_DECISIONS.allow,
            correlationId,
            sessionId,
            policyId,
            policyVersion: SELF_SIGN_UP_POLICY_VERSION,
            payload: {
              event_type: AUTH_AUDIT_EVENT_TYPES.authSignUpSuccess,
              actor_id: userId,
              organization_id: organizationId,
              decision: AUDIT_DECISIONS.allow,
              correlationId,
              session_id: sessionId,
              policy_id: policyId,
              policy_version: SELF_SIGN_UP_POLICY_VERSION,
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
      organization_id: organizationId,
      allowed_actions: allowedActions,
      correlationId,
    };
  }

  private recordFailure(correlationId: string, reasonCode: string) {
    return this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
      actorId: null,
      organizationId: null,
      resourceType: AUDIT_RESOURCE_TYPES.authOrganization,
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

function isValidOrganizationName(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim().length >= 1 &&
    value.trim().length <= MAX_ORGANIZATION_NAME_LENGTH
  );
}

function organizationSlug(name: string, organizationId: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "workspace"}-${organizationId.slice(0, 8)}`;
}

function uniqueActions(actions: readonly string[]): string[] {
  return [...new Set(actions)];
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
