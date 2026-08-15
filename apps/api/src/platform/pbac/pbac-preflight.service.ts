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

/**
 * Internal-only enriched preflight result. Policy metadata is returned from the
 * trusted membership/policy lookup, never accepted from a worker payload.
 */
export interface PbacPreflightPolicyResult extends PbacPreflightResult {
  policyId: string | null;
  policyVersion: string | null;
}

const DECISION_LOG_RESOURCE_TYPE = AUDIT_RESOURCE_TYPES.workerTask;

/**
 * Re-evaluates PBAC for a queued worker task immediately before processing so authorization reflects current membership and policy state.
 *
 * Unlike `PbacGuard`, this service does not reject an existing membership before evaluation solely because its status is no longer active.
 * A membership revoked after task dispatch must still reach `PbacEvaluatorService` so the state-gate rule can produce `STATE_GATE_FAILED`;
 * that case is intentionally distinct from a membership that does not exist at all.
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

  /**
   * Preserve the existing worker preflight contract without exposing policy
   * metadata over the public/internal HTTP response shape.
   */
  async evaluate(input: PbacPreflightInput): Promise<PbacPreflightResult> {
    const result = await this.evaluateWithPolicy(input);
    return {
      decision: result.decision,
      reasonCode: result.reasonCode,
      correlationId: result.correlationId,
    };
  }

  /**
   * Re-evaluate PBAC and return the trusted policy identifier/version used for
   * an allowed decision. This is intended for in-process protected command
   * dispatch, so mutation handlers never trust caller-supplied policy metadata.
   */
  async evaluateWithPolicy(
    input: PbacPreflightInput,
  ): Promise<PbacPreflightPolicyResult> {
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
      const policyId = result.policyId ?? policy.id;
      const policyVersion = result.policyVersion ?? policy.version;

      await this.recordDecision(
        input,
        result.decision,
        reasonCode,
        policyId,
        policyVersion,
      );

      return {
        decision: result.decision,
        reasonCode: result.decision === PBAC_DECISION.deny ? reasonCode : null,
        correlationId: input.correlationId,
        policyId: result.decision === PBAC_DECISION.allow ? policyId : null,
        policyVersion:
          result.decision === PBAC_DECISION.allow ? policyVersion : null,
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
        policyId: null,
        policyVersion: null,
      };
    }
  }

  private async deny(
    input: PbacPreflightInput,
    reasonCode: PbacReasonCode,
  ): Promise<PbacPreflightPolicyResult> {
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
      policyId: null,
      policyVersion: null,
    };
  }

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
