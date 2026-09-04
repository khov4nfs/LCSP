import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { type AuthUserRole } from "@lcsp/contracts/auth";
import {
  RBAC_DECISIONS,
  RBAC_REASON_CODES,
  type RbacDecision,
  type RbacReasonCode,
} from "@lcsp/contracts/rbac";
import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import type { UserRepository } from "../../modules/auth-workspace/application/ports/persistence/user.repository.js";
import {
  PrismaAuthorizationDecisionRepository,
  PrismaUserRepository,
} from "../../modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
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
    @Inject(PrismaUserRepository)
    private readonly users: UserRepository,
    @Inject(PrismaAuthorizationDecisionRepository)
    private readonly decisions: AuthorizationDecisionRepository,
  ) {}

  async evaluate(input: RbacPreflightInput): Promise<RbacPreflightResult> {
    try {
      const user = await this.users.findById(input.userId);
      if (!user) {
        return this.deny(input, RBAC_REASON_CODES.loadError);
      }

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
        `RBAC preflight evaluation failed (requiredRoles=${input.requiredRoles.join(",")}): ${(error as Error).message}`,
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
      this.logger.error(
        `Failed to write authorization AuditEvent for worker preflight (requiredRoles=${input.requiredRoles.join(",")}): ${(error as Error).message}`,
      );
    }
  }
}
