import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import type { AuthErrorCode } from "@lcsp/contracts/auth";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  RBAC_DECISIONS,
  RBAC_REASON_CODES,
  type RbacContextDenialReason,
  type RbacDecision,
  type RbacReasonCode,
} from "@lcsp/contracts/rbac";
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
  type HttpException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "../../common/interfaces/authenticated-request.interface.js";
import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import { PrismaAuthorizationDecisionRepository } from "../../modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
import { createCorrelationId } from "../../modules/auth-workspace/infrastructure/security/security.utils.js";
import { problemException } from "../problems/problem-factory.js";
import { RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY } from "../security/decorators/re-auth-for-sensitive-route.decorator.js";
import { isSensitiveActionVerificationFresh } from "../security/sensitive-route-policy.js";
import { ALLOW_PENDING_MFA_METADATA_KEY } from "./decorators/allow-pending-mfa.decorator.js";
import {
  RBAC_METADATA_KEY,
  type RbacMetadata,
} from "./decorators/rbac-metadata.js";
import { RbacContextLoader } from "./rbac-context.loader.js";

const DECISION_LOG_RESOURCE_TYPE = AUDIT_RESOURCE_TYPES.httpRoute;

export const LOCAL_RBAC_DECISIONS = RBAC_DECISIONS;

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly loader: RbacContextLoader,
    @Inject(PrismaAuthorizationDecisionRepository)
    private readonly decisions: AuthorizationDecisionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<RbacMetadata | undefined>(
      RBAC_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const correlationId =
      headerString(request.headers?.["x-correlation-id"]) ??
      createCorrelationId();
    request.correlationId = correlationId;

    const requestKey = requestMethodAndPath(request);
    const resourceId = requestResourceId(request, requestKey);

    if (!metadata) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        resourceId,
        decision: LOCAL_RBAC_DECISIONS.deny,
        reasonCode: RBAC_REASON_CODES.metadataMissing,
        correlationId,
      });
      throw this.rbacDenied(correlationId);
    }

    const token = this.extractToken(request);

    if (!token) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        resourceId,
        decision: LOCAL_RBAC_DECISIONS.deny,
        reasonCode: RBAC_REASON_CODES.sessionInvalid,
        correlationId,
      });
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const loaderResult = await this.loader.load(token, Date.now(), {
      allowPendingMfa:
        this.reflector.getAllAndOverride<boolean | undefined>(
          ALLOW_PENDING_MFA_METADATA_KEY,
          [context.getHandler(), context.getClass()],
        ) === true,
    });

    if (!loaderResult.ok) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        resourceId,
        decision: LOCAL_RBAC_DECISIONS.deny,
        reasonCode: loaderResult.reason,
        correlationId,
      });
      throw this.exceptionFor(loaderResult, correlationId);
    }

    const { session, user } = loaderResult;
    const requiresSensitiveReauth =
      this.reflector.getAllAndOverride<boolean | undefined>(
        RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) === true;

    if (metadata.type === "session") {
      await this.enforceSensitiveReauth({
        required: requiresSensitiveReauth,
        session,
        resourceId,
        correlationId,
      });
      request.rbacContext = {
        userId: session.userId,
        sessionId: session.id,
        role: user.role,
        scope: resourceId,
      };
      await this.recordDecision({
        actorId: session.userId,
        sessionId: session.id,
        resourceId,
        decision: LOCAL_RBAC_DECISIONS.allow,
        reasonCode: RBAC_REASON_CODES.authorized,
        correlationId,
      });
      return true;
    }

    // Handle "roles" metadata check
    const allowedRoles = metadata.roles;
    const hasRole = allowedRoles.includes(user.role);

    if (!hasRole) {
      await this.recordDecision({
        actorId: session.userId,
        sessionId: session.id,
        resourceId,
        decision: LOCAL_RBAC_DECISIONS.deny,
        reasonCode: RBAC_REASON_CODES.denied,
        correlationId,
      });
      throw this.rbacDenied(correlationId);
    }

    await this.enforceSensitiveReauth({
      required: requiresSensitiveReauth,
      session,
      resourceId,
      correlationId,
    });
    request.rbacContext = {
      userId: session.userId,
      sessionId: session.id,
      role: user.role,
      scope: resourceId,
    };
    await this.recordDecision({
      actorId: session.userId,
      sessionId: session.id,
      resourceId,
      decision: LOCAL_RBAC_DECISIONS.allow,
      reasonCode: RBAC_REASON_CODES.authorized,
      correlationId,
    });
    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers?.authorization;
    if (typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
  }

  private async enforceSensitiveReauth(input: {
    required: boolean;
    session: {
      id: string;
      userId: string;
      sensitiveActionVerifiedAt: number | null;
    };
    resourceId: string;
    correlationId: string;
  }): Promise<void> {
    if (
      !input.required ||
      isSensitiveActionVerificationFresh(
        input.session.sensitiveActionVerifiedAt,
        Date.now(),
      )
    ) {
      return;
    }

    await this.recordDecision({
      actorId: input.session.userId,
      sessionId: input.session.id,
      resourceId: input.resourceId,
      decision: LOCAL_RBAC_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.reauthRequired,
      correlationId: input.correlationId,
    });
    throw problemException(
      AUTH_ERROR_CODES.reauthRequired,
      input.correlationId,
      { status: HttpStatus.FORBIDDEN },
    );
  }

  private exceptionFor(
    denial:
      | { reason: RbacContextDenialReason; mfaEnrolled?: boolean }
      | RbacContextDenialReason,
    correlationId: string,
  ): HttpException {
    const reason = typeof denial === "string" ? denial : denial.reason;
    switch (reason) {
      case RBAC_REASON_CODES.sessionInvalid:
        return problemException(
          AUTH_ERROR_CODES.sessionInvalid,
          correlationId,
          { status: HttpStatus.UNAUTHORIZED },
        );
      case RBAC_REASON_CODES.mfaRequired:
        return problemException(AUTH_ERROR_CODES.mfaRequired, correlationId, {
          meta:
            typeof denial === "string"
              ? undefined
              : { mfaEnrolled: denial.mfaEnrolled === true },
          status: HttpStatus.UNAUTHORIZED,
        });
      case RBAC_REASON_CODES.loadError:
        return this.rbacDenied(correlationId);
    }
  }

  private rbacDenied(correlationId: string): HttpException {
    return problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }

  private async recordDecision(input: {
    actorId: string | null;
    sessionId: string | null;
    resourceId: string;
    decision: RbacDecision;
    reasonCode: AuthErrorCode | RbacReasonCode;
    correlationId: string;
  }): Promise<void> {
    try {
      await this.decisions.append({
        actor_id: input.actorId,
        session_id: input.sessionId,
        resource_type: DECISION_LOG_RESOURCE_TYPE,
        resource_id: input.resourceId,
        decision: input.decision,
        reason_code: input.reasonCode,
        correlationId: input.correlationId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write authorization AuditEvent (decision=${input.decision}): ${(error as Error).message}`,
      );
    }
  }
}

function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function readStringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requestMethodAndPath(request: AuthenticatedRequest): string {
  const method = request.method;
  const routePath = readStringAttribute(request.route?.path);
  if (method && routePath) return `${method} ${routePath}`;

  const originalUrl = request.originalUrl;
  if (method && originalUrl) return `${method} ${originalUrl.split("?")[0]}`;

  return "unknown:request";
}

function requestResourceId(
  request: AuthenticatedRequest,
  fallbackRequestKey: string,
): string {
  const params = request.params;
  const assessmentId = readStringAttribute(params.assessmentId);
  const conflictId = readStringAttribute(params.conflictId);
  const userId = readStringAttribute(params.userId);

  if (assessmentId && conflictId)
    return `assessment:${assessmentId}:conflict:${conflictId}`;
  if (assessmentId) return `assessment:${assessmentId}`;
  if (userId) return `user:${userId}`;

  return fallbackRequestKey;
}
