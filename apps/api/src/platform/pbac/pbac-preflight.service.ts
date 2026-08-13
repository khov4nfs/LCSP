import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  PBAC_DECISION,
  PBAC_REASON_CODE,
  type PbacDecisionValue,
  type PbacReasonCode,
} from "@lcsp/contracts/pbac";
import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import type { MembershipRepository } from "../../modules/auth-workspace/application/ports/persistence/membership.repository.js";
import type { PolicyRepository } from "../../modules/auth-workspace/application/ports/persistence/policy.repository.js";
import {
  PrismaAuthorizationDecisionRepository,
  PrismaMembershipRepository,
  PrismaPolicyRepository,
} from "../../modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
import { PbacEvaluatorService } from "./pbac-evaluator.service.js";
import type { PbacEvaluationContext, SubjectRole } from "./pbac.types.js";

export interface PbacPreflightInput {
  userId: string;
  organizationId: string;
  action: string;
  correlationId: string;
}

export interface PbacPreflightResult {
  decision: PbacDecisionValue;
  reasonCode: PbacReasonCode | null;
  correlationId: string;
}

const DECISION_LOG_RESOURCE_TYPE = AUDIT_RESOURCE_TYPES.workerTask;

/**
 * Re-evaluates PBAC for a Python worker task, on the worker's behalf, right
 * before it processes a queued message. Unlike PbacGuard, membership status
 * is NOT gated before evaluation — an existing-but-revoked membership must
 * still reach PbacEvaluatorService so its STATE_GATE_FAILED path fires (a
 * membership revoked after task dispatch is a distinct case from no
 * membership ever having existed).
 */
@Injectable()
export class PbacPreflightService {
  private readonly logger = new Logger(PbacPreflightService.name);

  constructor(
    @Inject(PrismaMembershipRepository)
    private readonly memberships: MembershipRepository,
    @Inject(PrismaPolicyRepository)
    private readonly policies: PolicyRepository,
    private readonly evaluator: PbacEvaluatorService,
    @Inject(PrismaAuthorizationDecisionRepository)
    private readonly decisions: AuthorizationDecisionRepository,
  ) {}

  async evaluate(input: PbacPreflightInput): Promise<PbacPreflightResult> {
    try {
      const membership = await this.memberships.findByUserAndOrganization(
        input.userId,
        input.organizationId,
      );
      if (!membership) {
        return this.deny(input, PBAC_REASON_CODE.membershipMissing);
      }

      const policy = await this.policies.findByIdAndVersion(
        membership.policyId,
        membership.policyVersion,
      );
      if (!policy) {
        return this.deny(input, PBAC_REASON_CODE.policyNotFound);
      }

      const evaluationContext: PbacEvaluationContext = {
        organizationId: input.organizationId,
        action: input.action,
        subject: {
          role: membership.role() as SubjectRole,
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

      const result = this.evaluator.evaluate(evaluationContext);
      const reasonCode =
        result.decision === PBAC_DECISION.deny
          ? (result.reasonCode ?? PBAC_REASON_CODE.denied)
          : PBAC_REASON_CODE.authorized;

      await this.recordDecision(
        input,
        result.decision,
        reasonCode,
        result.policyId,
        result.policyVersion,
      );

      return {
        decision: result.decision,
        reasonCode: result.decision === PBAC_DECISION.deny ? reasonCode : null,
        correlationId: input.correlationId,
      };
    } catch (error) {
      this.logger.error(
        `PBAC preflight evaluation failed (action=${input.action}): ${(error as Error).message}`,
      );
      await this.recordDecision(
        input,
        PBAC_DECISION.deny,
        PBAC_REASON_CODE.loadError,
        null,
        null,
      );
      return {
        decision: PBAC_DECISION.deny,
        reasonCode: PBAC_REASON_CODE.loadError,
        correlationId: input.correlationId,
      };
    }
  }

  private async deny(
    input: PbacPreflightInput,
    reasonCode: PbacReasonCode,
  ): Promise<PbacPreflightResult> {
    await this.recordDecision(
      input,
      PBAC_DECISION.deny,
      reasonCode,
      null,
      null,
    );
    return {
      decision: PBAC_DECISION.deny,
      reasonCode,
      correlationId: input.correlationId,
    };
  }

  /** Never throws — a decision-log write failure must not change the allow/deny outcome. */
  private async recordDecision(
    input: PbacPreflightInput,
    decision: PbacDecisionValue,
    reasonCode: PbacReasonCode,
    policyId: string | null,
    policyVersion: string | null,
  ): Promise<void> {
    try {
      await this.decisions.append({
        actor_id: input.userId,
        session_id: null,
        organization_id: input.organizationId,
        resource_type: DECISION_LOG_RESOURCE_TYPE,
        resource_id: input.action,
        action: input.action,
        decision,
        reason_code: reasonCode,
        policy_id: policyId,
        policy_version: policyVersion,
        correlationId: input.correlationId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write AuthDecisionLog for worker preflight (action=${input.action}): ${(error as Error).message}`,
      );
    }
  }
}

function readStringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
