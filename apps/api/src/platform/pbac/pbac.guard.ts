import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import type { AuthErrorCode } from "@lcsp/contracts/auth";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_METADATA_TYPES,
  PBAC_REASON_CODE,
  type PbacDecisionValue,
  type PbacReasonCode,
} from "@lcsp/contracts/pbac";
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

import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import { PrismaAuthorizationDecisionRepository } from "../../modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
import { createCorrelationId } from "../../modules/auth-workspace/infrastructure/security/security.utils.js";
import { ALLOW_PENDING_MFA_METADATA_KEY } from "./decorators/allow-pending-mfa.decorator.js";
import {
  PBAC_METADATA_KEY,
  type PbacMetadata,
} from "./decorators/pbac-metadata.js";
import {
  PbacContextLoader,
  type PbacContextDenialReason,
} from "./pbac-context.loader.js";
import { PbacEvaluatorService } from "./pbac-evaluator.service.js";
import type {
  PbacDecisionResult,
  PbacEvaluationContext,
  SubjectRole,
} from "./pbac.types.js";

import type { AuthenticatedRequest } from "../../common/interfaces/authenticated-request.interface.js";
import { problemException } from "../problems/problem-factory.js";
import { RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY } from "../security/decorators/re-auth-for-sensitive-route.decorator.js";
import { isSensitiveActionVerificationFresh } from "../security/sensitive-route-policy.js";

const DECISION_LOG_RESOURCE_TYPE = AUDIT_RESOURCE_TYPES.httpRoute;

/**
 * Enforces route PBAC metadata by validating session context, membership, policy actions, and optional sensitive-route re-authentication.
 */
@Injectable()
export class PbacGuard implements CanActivate {
  private readonly logger = new Logger(PbacGuard.name);

  /**
   * Creates the guard with metadata lookup, context loading, policy evaluation, and decision logging dependencies.
   *
   * @param reflector - Nest reflector used to read route and controller authorization metadata.
   * @param loader - PBAC context loader that validates session, MFA, membership, and policy state.
   * @param evaluator - Deterministic evaluator used to decide requested PBAC actions.
   * @param decisions - Repository used to persist authorization decision logs.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly loader: PbacContextLoader,
    private readonly evaluator: PbacEvaluatorService,
    @Inject(PrismaAuthorizationDecisionRepository)
    private readonly decisions: AuthorizationDecisionRepository,
  ) {}

  /**
   * Authorizes an incoming HTTP request from route metadata and attaches the resolved PBAC context when allowed.
   *
   * @param context - Nest execution context containing handler metadata and the incoming HTTP request.
   * @returns True when all required session, membership, policy, and sensitive-route checks succeed.
   * @throws A standardized authentication or PBAC problem when any required check fails.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PbacMetadata | undefined>(
      PBAC_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const allowPendingMfa =
      this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_MFA_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) === true;
    const requiresSensitiveReauth =
      this.reflector.getAllAndOverride<boolean | undefined>(
        RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) === true;
    const correlationId =
      headerString(request.headers?.["x-correlation-id"]) ??
      createCorrelationId();
    request.correlationId = correlationId;

    if (!metadata) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        organizationId: null,
        resourceId: requestResourceId(request, PBAC_ACTIONS.metadataCheck),
        action: PBAC_ACTIONS.metadataCheck,
        decision: PBAC_DECISION.deny,
        reasonCode: PBAC_REASON_CODE.metadataMissing,
        policyId: null,
        policyVersion: null,
        correlationId,
      });
      throw this.pbacDenied(correlationId);
    }

    const candidateActions =
      metadata.type === PBAC_METADATA_TYPES.action
        ? [metadata.action]
        : metadata.type === PBAC_METADATA_TYPES.actionAny
          ? metadata.actions
          : [];
    const action = candidateActions[0] ?? PBAC_ACTIONS.sessionVerify;
    const resourceId = requestResourceId(request, action);

    const token = this.extractToken(request);
    if (!token) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        organizationId: null,
        resourceId,
        action,
        decision: PBAC_DECISION.deny,
        reasonCode: PBAC_REASON_CODE.sessionInvalid,
        policyId: null,
        policyVersion: null,
        correlationId,
      });
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const loaderResult = await this.loader.load(token, Date.now(), {
      allowPendingMfa,
    });

    if (!loaderResult.ok) {
      await this.recordDecision({
        actorId: null,
        sessionId: null,
        organizationId: null,
        resourceId,
        action,
        decision: PBAC_DECISION.deny,
        reasonCode: loaderResult.reason,
        policyId: null,
        policyVersion: null,
        correlationId,
      });
      throw this.exceptionFor(
        loaderResult,
        correlationId,
        metadata.membershipMissingAsPbacDenied === true,
      );
    }

    const { session, membership, policy } = loaderResult;
    const subjectRole = membership.role();
    if (!subjectRole) {
      await this.recordDecision({
        actorId: session.userId,
        sessionId: session.id,
        organizationId: session.organizationId,
        resourceId,
        action,
        decision: PBAC_DECISION.deny,
        reasonCode: PBAC_REASON_CODE.subjectAttributeMissing,
        policyId: policy.id,
        policyVersion: policy.version,
        correlationId,
      });
      throw this.pbacDenied(correlationId);
    }

    if (metadata.type === PBAC_METADATA_TYPES.session) {
      // @RequireSession() — session + active membership only, no PBAC action gate.
      await this.enforceSensitiveReauth({
        required: requiresSensitiveReauth,
        session,
        resourceId,
        action,
        policyId: policy.id,
        policyVersion: policy.version,
        correlationId,
      });
      request.pbacContext = {
        userId: session.userId,
        sessionId: session.id,
        organizationId: session.organizationId,
        subjectRole: subjectRole as SubjectRole,
        scope: readStringAttribute(membership.subjectAttributes.scope) ?? null,
        grantedActions: policy.actions,
        selectedAction: null,
        policyId: policy.id,
        policyVersion: policy.version,
      };
      await this.recordDecision({
        actorId: session.userId,
        sessionId: session.id,
        organizationId: session.organizationId,
        resourceId,
        action,
        decision: PBAC_DECISION.allow,
        reasonCode: PBAC_REASON_CODE.authorized,
        policyId: policy.id,
        policyVersion: policy.version,
        correlationId,
      });
      return true;
    }

    const deniedDecisions: Array<{
      action: string;
      decision: PbacDecisionResult;
    }> = [];
    let allowed: { action: string; decision: PbacDecisionResult } | undefined;

    for (const candidateAction of candidateActions) {
      const evaluationContext: PbacEvaluationContext = {
        organizationId: session.organizationId,
        action: candidateAction,
        subject: {
          role: subjectRole as SubjectRole,
          scope: readStringAttribute(membership.subjectAttributes.scope),
        },
        policy: {
          id: policy.id,
          organizationId: policy.organizationId,
          version: policy.version,
          subjectRole: policy.subjectRole as SubjectRole,
          stateGate: policy.stateGate,
          actions: policy.actions,
        },
        membershipStatus: membership.status,
      };

      let decision: PbacDecisionResult;
      try {
        decision = this.evaluator.evaluate(evaluationContext);
      } catch (error) {
        this.logger.error(
          `PBAC evaluator threw — defaulting to deny: ${(error as Error).message}`,
        );
        await this.recordDecision({
          actorId: session.userId,
          sessionId: session.id,
          organizationId: session.organizationId,
          resourceId,
          action: candidateAction,
          decision: PBAC_DECISION.deny,
          reasonCode: PBAC_REASON_CODE.evaluatorError,
          policyId: policy.id,
          policyVersion: policy.version,
          correlationId,
        });
        throw this.pbacDenied(correlationId);
      }

      if (decision.decision === PBAC_DECISION.allow) {
        allowed = { action: candidateAction, decision };
        break;
      }
      deniedDecisions.push({ action: candidateAction, decision });
    }

    if (!allowed) {
      for (const denied of deniedDecisions) {
        await this.recordDecision({
          actorId: session.userId,
          sessionId: session.id,
          organizationId: session.organizationId,
          resourceId,
          action: denied.action,
          decision: PBAC_DECISION.deny,
          reasonCode: denied.decision.reasonCode ?? PBAC_REASON_CODE.denied,
          policyId: denied.decision.policyId || null,
          policyVersion: denied.decision.policyVersion || null,
          correlationId,
        });
      }
      throw this.pbacDenied(correlationId);
    }

    await this.enforceSensitiveReauth({
      required: requiresSensitiveReauth,
      session,
      resourceId,
      action: allowed.action,
      policyId: allowed.decision.policyId ?? policy.id,
      policyVersion: allowed.decision.policyVersion ?? policy.version,
      correlationId,
    });

    request.pbacContext = {
      userId: session.userId,
      sessionId: session.id,
      organizationId: session.organizationId,
      subjectRole: subjectRole as SubjectRole,
      scope: readStringAttribute(membership.subjectAttributes.scope) ?? null,
      grantedActions: policy.actions,
      selectedAction: allowed.action,
      policyId: allowed.decision.policyId ?? null,
      policyVersion: allowed.decision.policyVersion ?? null,
    };

    await this.recordDecision({
      actorId: session.userId,
      sessionId: session.id,
      organizationId: session.organizationId,
      resourceId,
      action: allowed.action,
      decision: PBAC_DECISION.allow,
      reasonCode: PBAC_REASON_CODE.authorized,
      policyId: allowed.decision.policyId,
      policyVersion: allowed.decision.policyVersion,
      correlationId,
    });

    return true;
  }

  /**
   * Extracts a bearer token from the request Authorization header without accepting alternate schemes.
   *
   * @param request - Authenticated-request shape containing HTTP headers.
   * @returns Bearer token value, or null when the header is missing or malformed.
   */
  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers?.authorization;
    if (typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
  }

  /**
   * Enforces recent sensitive-action verification for routes marked as requiring re-authentication.
   *
   * @param input - Requirement flag, session verification timestamp, resource/action context, policy metadata, and correlation ID.
   * @returns A promise that resolves when re-authentication is unnecessary or still fresh.
   * @throws A standardized re-auth-required problem when sensitive verification is stale or absent.
   */
  private async enforceSensitiveReauth(input: {
    required: boolean;
    session: {
      id: string;
      userId: string;
      organizationId: string;
      sensitiveActionVerifiedAt: number | null;
    };
    resourceId: string;
    action: string;
    policyId: string | null;
    policyVersion: string | null;
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
      organizationId: input.session.organizationId,
      resourceId: input.resourceId,
      action: input.action,
      decision: PBAC_DECISION.deny,
      reasonCode: AUTH_ERROR_CODES.reauthRequired,
      policyId: input.policyId,
      policyVersion: input.policyVersion,
      correlationId: input.correlationId,
    });
    throw problemException(
      AUTH_ERROR_CODES.reauthRequired,
      input.correlationId,
      {
        status: HttpStatus.FORBIDDEN,
      },
    );
  }

  /**
   * Maps PBAC context-loading denial reasons to the external authentication/PBAC exception contract.
   *
   * @param denial - Context-loader denial reason and optional MFA enrollment metadata.
   * @param correlationId - Correlation identifier attached to the resulting problem.
   * @param membershipMissingAsPbacDenied - Whether missing membership should be hidden behind a generic PBAC denial.
   * @returns HTTP exception representing the appropriate external denial.
   */
  private exceptionFor(
    denial:
      | { reason: PbacContextDenialReason; mfaEnrolled?: boolean }
      | PbacContextDenialReason,
    correlationId: string,
    membershipMissingAsPbacDenied = false,
  ): HttpException {
    const reason = typeof denial === "string" ? denial : denial.reason;
    switch (reason) {
      case PBAC_REASON_CODE.sessionInvalid:
        return problemException(
          AUTH_ERROR_CODES.sessionInvalid,
          correlationId,
          {
            status: HttpStatus.UNAUTHORIZED,
          },
        );
      case PBAC_REASON_CODE.mfaRequired:
        return problemException(AUTH_ERROR_CODES.mfaRequired, correlationId, {
          meta:
            typeof denial === "string"
              ? undefined
              : {
                  mfaEnrolled: denial.mfaEnrolled === true,
                },
          status: HttpStatus.UNAUTHORIZED,
        });
      case PBAC_REASON_CODE.membershipMissing:
        if (membershipMissingAsPbacDenied) {
          return this.pbacDenied(correlationId);
        }
        return problemException(
          AUTH_ERROR_CODES.membershipMissing,
          correlationId,
          {
            status: HttpStatus.FORBIDDEN,
          },
        );
      case PBAC_REASON_CODE.policyNotFound:
      case PBAC_REASON_CODE.loadError:
        return this.pbacDenied(correlationId);
    }
  }

  /**
   * Creates the generic forbidden exception used when detailed PBAC denial information must not be exposed.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @returns Standard PBAC-denied HTTP exception.
   */
  private pbacDenied(correlationId: string): HttpException {
    return problemException(AUTH_ERROR_CODES.pbacDenied, correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }

  /**
   * Appends an authorization decision log without allowing audit-log failures to change the authorization outcome.
   *
   * @param input - Actor, session, organization, resource, action, decision, policy, reason, and correlation metadata.
   * @returns A promise that always resolves after the append succeeds or its failure is logged.
   */
  private async recordDecision(input: {
    actorId: string | null;
    sessionId: string | null;
    organizationId: string | null;
    resourceId: string;
    action: string;
    decision: PbacDecisionValue;
    reasonCode: AuthErrorCode | PbacReasonCode;
    policyId: string | null;
    policyVersion: string | null;
    correlationId: string;
  }): Promise<void> {
    try {
      await this.decisions.append({
        actor_id: input.actorId,
        session_id: input.sessionId,
        organization_id: input.organizationId,
        resource_type: DECISION_LOG_RESOURCE_TYPE,
        resource_id: input.resourceId,
        action: input.action,
        decision: input.decision,
        reason_code: input.reasonCode,
        policy_id: input.policyId,
        policy_version: input.policyVersion,
        correlationId: input.correlationId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write AuthDecisionLog (action=${input.action}, decision=${input.decision}): ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Reads a subject or route attribute only when its runtime value is a string.
 *
 * @param value - Unknown attribute value to inspect.
 * @returns String value when valid; otherwise undefined.
 */
function readStringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Normalizes a correlation header to one non-empty string value.
 *
 * @param value - Raw HTTP header value.
 * @returns First non-empty string value, or null when absent.
 */
function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}

/**
 * Derives a stable, human-readable authorization resource identifier from common route parameters or request metadata.
 *
 * @param request - Incoming request containing route params, method, route path, and original URL.
 * @param fallbackAction - Action identifier used when no more specific resource can be derived.
 * @returns Resource identifier used in authorization decision logs.
 */
function requestResourceId(
  request: AuthenticatedRequest,
  fallbackAction: string,
): string {
  const params = request.params;
  const assessmentId = readStringAttribute(params.assessmentId);
  const conflictId = readStringAttribute(params.conflictId);
  const userId = readStringAttribute(params.userId);
  const orgId =
    readStringAttribute(params.orgId) ?? readStringAttribute(params.id);

  if (assessmentId && conflictId)
    return `assessment:${assessmentId}:conflict:${conflictId}`;
  if (assessmentId) return `assessment:${assessmentId}`;
  if (userId) return `user:${userId}`;
  if (orgId) return `organization:${orgId}`;

  const method = request.method;
  const routePath = readStringAttribute(request.route?.path);
  if (method && routePath) return `${method} ${routePath}`;

  const originalUrl = request.originalUrl;
  if (method && originalUrl) return `${method} ${originalUrl.split("?")[0]}`;

  return fallbackAction;
}
