import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { USER_ACCESS_STATUSES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  RBAC_DECISIONS,
  RBAC_REASON_CODES,
  type RbacDecision,
  type RbacReasonCode,
} from "@lcsp/contracts/rbac";
import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  AUTH_USER_REPOSITORY,
  type UserRepository,
} from "../../modules/auth/application/ports/persistence/index.js";
import type { AuthorizationDecisionRepository } from "./authorization-decision.repository.js";
import { PrismaAuthorizationDecisionRepository } from "./prisma-authorization-decision.repository.js";
export interface RbacPreflightInput {
  userId: string;
  requiredRoles: readonly AuthUserRole[];
  correlationId: string;
}

export interface RbacPreflightResult {
  decision: RbacDecision;
  reasonCode: RbacReasonCode | null;
  correlationId: string;
}

const DECISION_LOG_RESOURCE_TYPE = AUDIT_RESOURCE_TYPES.workerTask;

@Injectable()
export class RbacPreflightService {
  private readonly logger = new Logger(RbacPreflightService.name);

  constructor(
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(PrismaAuthorizationDecisionRepository)
    private readonly decisions: AuthorizationDecisionRepository,
  ) {}

  /**
   * Business purpose: Decide whether a worker request may execute under the configured RBAC role requirement.
   * Business rules:
   * - Only an active persisted user holding one required role may receive ALLOW.
   * - ALLOW requires durable decision evidence; any unauditable ALLOW is converted to a fail-closed DENY.
   * Execution flow:
   * 1. Load the user, validate active status and role membership, and persist the resulting RBAC decision.
   * 2. Return ALLOW only after audit persistence succeeds; otherwise record and return a load-error DENY.
   * Failure cases:
   * - Missing, suspended, unauthorized, repository, or ALLOW-audit failures return DENY with a canonical reason.
   * Side effects:
   * - Reads one user and persists primary or durable-fallback authorization evidence.
   */
  async evaluate(input: RbacPreflightInput): Promise<RbacPreflightResult> {
    try {
      const user = await this.users.findById(input.userId);
      if (!user) {
        return this.deny(input, RBAC_REASON_CODES.loadError);
      }

      if (user.accessStatus !== USER_ACCESS_STATUSES.active)
        return this.deny(input, RBAC_REASON_CODES.accountSuspended);

      if (!input.requiredRoles.includes(user.role)) {
        return this.deny(input, RBAC_REASON_CODES.denied);
      }

      await this.recordDecision(
        input,
        RBAC_DECISIONS.allow,
        RBAC_REASON_CODES.authorized,
      );
      return {
        decision: RBAC_DECISIONS.allow,
        reasonCode: null,
        correlationId: input.correlationId,
      };
    } catch (error) {
      this.logger.error(
        `RBAC preflight evaluation failed requiredRoles=${input.requiredRoles.join(",")} correlationId=${input.correlationId} failure=${error instanceof Error ? error.name : typeof error}`,
      );
      await this.recordDecision(
        input,
        RBAC_DECISIONS.deny,
        RBAC_REASON_CODES.loadError,
      );
      return {
        decision: RBAC_DECISIONS.deny,
        reasonCode: RBAC_REASON_CODES.loadError,
        correlationId: input.correlationId,
      };
    }
  }

  private async deny(
    input: RbacPreflightInput,
    reasonCode: RbacReasonCode,
  ): Promise<RbacPreflightResult> {
    await this.recordDecision(input, RBAC_DECISIONS.deny, reasonCode);
    return {
      decision: RBAC_DECISIONS.deny,
      reasonCode,
      correlationId: input.correlationId,
    };
  }

  /**
   * Business purpose: Persist evidence for one worker RBAC outcome without weakening a denial during an audit outage.
   * Business rules:
   * - DENY remains authoritative when evidence persistence fails; ALLOW failure must propagate to the fail-closed caller path.
   * Execution flow:
   * 1. Append the normalized actor, worker resource, decision, reason, and correlation fields.
   * 2. On persistence failure, emit bounded diagnostics and rethrow only an ALLOW failure.
   * Failure cases:
   * - Repository failure rejects ALLOW but is deliberately swallowed for an already-decided DENY.
   * Side effects:
   * - Writes canonical or durable-fallback authorization evidence and may emit one sanitized error log.
   */
  private async recordDecision(
    input: RbacPreflightInput,
    decision: RbacDecision,
    reasonCode: RbacReasonCode,
  ): Promise<void> {
    try {
      await this.decisions.append({
        actor_id: input.userId,
        session_id: null,
        resource_type: DECISION_LOG_RESOURCE_TYPE,
        resource_id: input.requiredRoles.join(","),
        decision,
        reason_code: reasonCode,
        correlationId: input.correlationId,
      });
    } catch (error) {
      // DENY must remain DENY even if evidence persistence is unavailable.
      // ALLOW may proceed only when the repository persisted primary or
      // fallback evidence, so rejection is propagated to evaluate's deny path.
      this.logger.error(
        `Worker preflight authorization audit unavailable decision=${decision} correlationId=${input.correlationId} failure=${error instanceof Error ? error.name : typeof error}`,
      );
      if (decision === RBAC_DECISIONS.allow) throw error;
    }
  }
}
