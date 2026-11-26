import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferences,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  computeRepositorySetDigest,
  deriveRepositoryKey,
  type RepositoryPin,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { repositorySourcePathPrefixSchema } from "@lcsp/contracts/github-integration";
import { legalApplicabilityLogicSchema } from "@lcsp/contracts/compliance-rule-set";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { criterionIdsOf, listLength } from "../../domain/rule-criteria.js";

export const ROOT_AUDIT_ACTOR = {
  id: AUDIT_ACTOR_IDS.assessmentRootAgent,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

export type PinnedRepository = RepositoryPin;

/**
 * The immutable pins of one case. The scalar repository fields describe the primary repository
 * (ordinal 0) and stay for readers not yet converted; `repositories` is the authoritative set and
 * `repositorySetDigest` proves it is unchanged.
 */
export interface PinnedCase {
  assessmentId: string;
  caseRevision: number;
  ruleSetVersionId: string;
  repositorySnapshotId: string;
  repositoryId: string;
  repositoryScanJobId: string;
  repositoryCommit: string;
  sourcePathPrefix: string | null;
  repositorySetDigest: string;
  repositories: PinnedRepository[];
  /**
   * True when the pins are recorded rows; false when the set was derived from the scalar pin of a case
   * written before the set existed. Only recorded pins may be referenced by foreign keys.
   */
  repositorySetRecorded: boolean;
}

export function invalid(code: string, correlationId: string) {
  return problemException(code, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

/**
 * Prisma reads/guards shared by the Assessment Root use-case handlers: pins, rule
 * coverage rows and decision-validation context. Holds no use-case orchestration.
 */
@Injectable()
export class AssessmentCaseSupport {
  async lockCase(tx: Prisma.TransactionClient, assessmentId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "AssessmentCase" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
  }

  /**
   * Business purpose: Load the immutable case pins and the source boundary of their own repository snapshot.
   *
   * Business rules:
   * - The case must have complete rule-set and repository pins.
   * - Source scope comes only from the pinned snapshot owned by this assessment at the same commit.
   * - Null preserves an existing whole-repository snapshot; missing or malformed scope metadata fails closed.
   * - The repository set is the recorded pin rows; a case written before the set existed is read as a set
   *   of one derived from its scalar pin. The primary pin (ordinal 0) must equal the scalar pin and any
   *   stored set digest must match the recomputed one.
   *
   * Execution flow:
   * 1. Read the case and reject incomplete or inconsistent ownership.
   * 2. Read its exact assessment-bound snapshot and verify commit identity and canonical source scope.
   * 3. Read the recorded repository pins, verify them against the scalar pin, their own snapshots and the
   *    stored digest, or derive the one-pin set for older cases.
   * 4. Return case revision, repository pins, the set digest and the stored prefix without normalization.
   *
   * Failure cases:
   * - Missing pins, a missing or foreign snapshot, mismatched commit or invalid prefix produces PINS_NOT_READY.
   * - A set whose primary pin, count, member snapshots or digest disagree with the case produces PINS_NOT_READY.
   *
   * Side effects:
   * - Read-only database queries; existing snapshot scope and case history are never rewritten.
   */
  async loadPins(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    _forWrite = false,
  ): Promise<PinnedCase> {
    void _forWrite;
    const row = await tx.assessmentCase.findUnique({ where: { assessmentId } });
    if (
      !row ||
      row.assessmentId !== assessmentId ||
      !row.ruleSetVersionId ||
      !row.repositorySnapshotId ||
      !row.repositoryScanJobId ||
      !row.repositoryCommit
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const snapshot = await tx.repositorySnapshot.findFirst({
      where: {
        id: row.repositorySnapshotId,
        assessmentId,
        commitSha: {
          equals: row.repositoryCommit,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      select: {
        id: true,
        repositoryId: true,
        assessmentId: true,
        commitSha: true,
        sourcePathPrefix: true,
        connectionId: true,
        repositoryFullName: true,
      },
    });
    if (
      !snapshot ||
      snapshot.id !== row.repositorySnapshotId ||
      snapshot.assessmentId !== assessmentId ||
      !snapshot.repositoryId ||
      snapshot.commitSha.toLowerCase() !== row.repositoryCommit.toLowerCase() ||
      (snapshot.sourcePathPrefix !== null &&
        !repositorySourcePathPrefixSchema.safeParse(snapshot.sourcePathPrefix)
          .success)
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const { repositories, recorded } = await this.loadRepositorySet(tx, {
      assessmentId,
      correlationId,
      repositoryCount: row.repositoryCount,
      storedDigest: row.repositorySetDigest,
      primary: {
        repositorySnapshotId: row.repositorySnapshotId,
        repositoryScanJobId: row.repositoryScanJobId,
        repositoryCommit: row.repositoryCommit,
        snapshot,
      },
    });
    return {
      assessmentId,
      caseRevision: row.caseRevision,
      ruleSetVersionId: row.ruleSetVersionId,
      repositorySnapshotId: row.repositorySnapshotId,
      repositoryId: snapshot.repositoryId,
      repositoryScanJobId: row.repositoryScanJobId,
      repositoryCommit: row.repositoryCommit,
      sourcePathPrefix: snapshot.sourcePathPrefix,
      repositorySetDigest: computeRepositorySetDigest(repositories),
      repositories,
      repositorySetRecorded: recorded,
    };
  }

  /**
   * Business purpose: Resolve the complete, verified set of repositories an assessment is pinned to.
   *
   * Business rules:
   * - Recorded pin rows are authoritative; ordinal 0 must be the case scalar pin.
   * - Every additional pin must reference a snapshot owned by this assessment at the pinned commit with a
   *   canonical source scope.
   * - A case with no recorded rows is a set of one derived from the scalar pin; a stored digest or count
   *   that disagrees with the recorded rows is rejected.
   *
   * Execution flow:
   * 1. Read pin rows in ordinal order; derive the single pin when there are none.
   * 2. Check primary identity, contiguous ordinals, stored count and (for extra pins) snapshot ownership.
   * 3. Check the stored digest against the recomputed digest.
   *
   * Failure cases:
   * - Any disagreement produces PINS_NOT_READY (409).
   *
   * Side effects:
   * - Read-only database queries.
   */
  async loadRepositorySet(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
      repositoryCount: number;
      storedDigest: string | null;
      primary: {
        repositorySnapshotId: string;
        repositoryScanJobId: string;
        repositoryCommit: string;
        snapshot: {
          repositoryId: string;
          connectionId: string;
          repositoryFullName: string;
          sourcePathPrefix: string | null;
        };
      };
    },
  ): Promise<{ repositories: PinnedRepository[]; recorded: boolean }> {
    const notReady = problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
      input.correlationId,
      { status: HttpStatus.CONFLICT },
    );
    const { primary } = input;
    const rows = await tx.assessmentCaseRepository.findMany({
      where: { assessmentId: input.assessmentId },
      orderBy: { ordinal: "asc" },
    });
    if (rows.length === 0) {
      return {
        recorded: false,
        repositories: [
          {
            repositoryKey: deriveRepositoryKey(
              primary.snapshot.repositoryFullName,
              [],
            ),
            ordinal: 0,
            connectionId: primary.snapshot.connectionId,
            repositoryId: primary.snapshot.repositoryId,
            repositoryFullName: primary.snapshot.repositoryFullName,
            repositorySnapshotId: primary.repositorySnapshotId,
            repositoryScanJobId: primary.repositoryScanJobId,
            repositoryCommit: primary.repositoryCommit,
            sourcePathPrefix: primary.snapshot.sourcePathPrefix,
          },
        ],
      };
    }
    const first = rows[0];
    if (
      !first ||
      first.ordinal !== 0 ||
      first.repositorySnapshotId !== primary.repositorySnapshotId ||
      first.repositoryCommit.toLowerCase() !==
        primary.repositoryCommit.toLowerCase() ||
      rows.some((pin, index) => pin.ordinal !== index) ||
      (input.repositoryCount > 0 && input.repositoryCount !== rows.length)
    ) {
      throw notReady;
    }
    const extraIds = rows.slice(1).map((pin) => pin.repositorySnapshotId);
    if (extraIds.length > 0) {
      const snapshots = await tx.repositorySnapshot.findMany({
        where: { id: { in: extraIds }, assessmentId: input.assessmentId },
        select: { id: true, commitSha: true, sourcePathPrefix: true },
      });
      const byId = new Map(
        snapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
      for (const pin of rows.slice(1)) {
        const snapshot = byId.get(pin.repositorySnapshotId);
        if (
          !snapshot ||
          snapshot.commitSha.toLowerCase() !==
            pin.repositoryCommit.toLowerCase() ||
          (snapshot.sourcePathPrefix !== null &&
            !repositorySourcePathPrefixSchema.safeParse(
              snapshot.sourcePathPrefix,
            ).success)
        ) {
          throw notReady;
        }
      }
    }
    const repositories = rows.map((pin) => ({
      repositoryKey: pin.repositoryKey,
      ordinal: pin.ordinal,
      connectionId: pin.connectionId,
      repositoryId: pin.repositoryId,
      repositoryFullName: pin.repositoryFullName,
      repositorySnapshotId: pin.repositorySnapshotId,
      repositoryScanJobId: pin.repositoryScanJobId,
      repositoryCommit: pin.repositoryCommit,
      sourcePathPrefix: pin.sourcePathPrefix,
    }));
    if (
      input.storedDigest !== null &&
      input.storedDigest !== computeRepositorySetDigest(repositories)
    ) {
      throw notReady;
    }
    return { repositories, recorded: true };
  }

  /**
   * Business purpose: Gate every rule action to a persisted coverage member of the current audit request.
   * Business rules:
   * - Customer-selected cases require frozen membership; legacy cases use existing full coverage.
   * Execution flow:
   * 1. Check audit mode and current request membership when selection is required.
   * 2. Load the rule's decision coverage record.
   * Failure cases:
   * - Unrequested or missing rules reject before investigation, decision or human-question writes.
   * Side effects:
   * - Read-only transaction helper; it does not create coverage or outcomes.
   */
  async requireCoverage(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    assessmentRuleId: string,
    correlationId: string,
  ) {
    const auditCase = await tx.assessmentCase.findUnique({
      where: { assessmentId },
      select: { auditMode: true },
    });
    if (auditCase?.auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED) {
      const runtime = await tx.assessmentRuntime.findUnique({
        where: { assessmentId },
        select: { currentAuditRequestId: true },
      });
      const member = runtime?.currentAuditRequestId
        ? await tx.assessmentRuleAuditItem.findUnique({
            where: {
              requestId_assessmentRuleId: {
                requestId: runtime.currentAuditRequestId,
                assessmentRuleId,
              },
            },
          })
        : null;
      if (!member) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RULE_NOT_IN_RULE_SET,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
    }
    const row = await tx.assessmentDecisionCoverage.findUnique({
      where: {
        assessmentId_assessmentRuleId: { assessmentId, assessmentRuleId },
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RULE_NOT_IN_RULE_SET,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return row;
  }

  /**
   * Business purpose: Advance rule decision coverage to RESOLVED along the canonical state transition table.
   *
   * Business rules:
   * - Coverage may transition to RESOLVED from PENDING, INVALIDATED, or INVESTIGATING.
   * - Direct transition from WAITING_FOR_INPUT to RESOLVED without resolving human dependencies is rejected.
   *
   * Execution flow:
   * 1. Reject illegal transitions from WAITING_FOR_INPUT.
   * 2. Step through INVESTIGATING for initial or recovering transitions from PENDING or INVALIDATED.
   * 3. Record the new resolved decision ID, revision, and RESOLVED status under the caller's transaction.
   *
   * Failure cases:
   * - Transition from WAITING_FOR_INPUT throws DECISION_REVISION_STALE with HTTP 409 Conflict.
   *
   * Side effects:
   * - Updates AssessmentDecisionCoverage row in the database.
   */
  async advanceCoverageToResolved(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      assessmentRuleId: string;
      from: string;
      decisionId: string;
      decisionRevision: number;
    },
  ) {
    if (input.from === DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.DECISION_REVISION_STALE,
        "",
        { status: HttpStatus.CONFLICT },
      );
    }
    const key = {
      assessmentId_assessmentRuleId: {
        assessmentId: input.assessmentId,
        assessmentRuleId: input.assessmentRuleId,
      },
    };
    // Walk the transition table (PENDING/INVALIDATED -> INVESTIGATING -> RESOLVED).
    if (
      input.from === DECISION_RESOLUTION_STATES.PENDING ||
      input.from === DECISION_RESOLUTION_STATES.INVALIDATED
    ) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING },
      });
    }
    await tx.assessmentDecisionCoverage.update({
      where: key,
      data: {
        resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
        currentDecisionId: input.decisionId,
        decisionRevision: input.decisionRevision,
      },
    });
  }

  async moveCoverageToWaiting(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; assessmentRuleId: string; from: string },
  ) {
    const key = {
      assessmentId_assessmentRuleId: {
        assessmentId: input.assessmentId,
        assessmentRuleId: input.assessmentRuleId,
      },
    };
    if (
      input.from === DECISION_RESOLUTION_STATES.PENDING ||
      input.from === DECISION_RESOLUTION_STATES.INVALIDATED
    ) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING },
      });
    }
    if (input.from !== DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT },
      });
    }
  }

  /**
   * Business purpose: Assemble server-owned rule, fact and evidence authority for deterministic
   *   validation of a Root-authored decision.
   *
   * Business rules:
   * - Resolve the AssessmentRule and directly related legal-context targets only within the
   *   pinned Rule Set.
   * - Load cited facts and their supporting evidence only from this Assessment;
   *   applicability-element and operative-scope counts come from linked LegalRequirements, never inferred legal
   *   categories.
   *
   * Execution flow:
   * 1. Read the pinned rule, linked requirements and outgoing context targets.
   * 2. Resolve the decision’s cited facts, then collect direct evidence references and those
   *   facts’ evidence links.
   * 3. Return exact pins/revision, criterion and legal-context identities, declared-element
   *   counts, source-authored applicability logic and record maps; missing legacy logic remains unknown.
   *
   * Failure cases:
   * - A missing rule remains null and missing facts/evidence remain absent, allowing the
   *   validator to reject them; database failures propagate.
   *
   * Side effects:
   * - Read-only queries inside the supplied transaction; does not accept references or alter
   *   model conclusions.
   */
  async buildValidationContext(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; pins: PinnedCase; decision: RuleDecision },
  ) {
    const { assessmentId, pins, decision } = input;
    const rule = await tx.assessmentRule.findUnique({
      where: {
        ruleSetVersionId_assessmentRuleId: {
          ruleSetVersionId: pins.ruleSetVersionId,
          assessmentRuleId: decision.assessmentRuleId,
        },
      },
      include: {
        legalRequirementLinks: {
          include: {
            legalRequirement: {
              select: {
                id: true,
                legalRequirementId: true,
                applicabilityConditions: true,
                applicabilityLogic: true,
                qualifiers: true,
                exceptions: true,
                operativePropositions: true,
              },
            },
          },
        },
      },
    });
    let legalContextIds = new Set<string>();
    if (rule) {
      const linkedRowIds = rule.legalRequirementLinks.map(
        (link) => link.legalRequirement.id,
      );
      legalContextIds = new Set(
        rule.legalRequirementLinks.map(
          (link) => link.legalRequirement.legalRequirementId,
        ),
      );
      const relations = await tx.legalRequirementContextRelation.findMany({
        where: {
          ruleSetVersionId: pins.ruleSetVersionId,
          fromRuleId: { in: linkedRowIds },
          toRuleId: { not: null },
        },
        select: { toRuleId: true },
      });
      const targets = relations.flatMap((r) =>
        r.toRuleId ? [r.toRuleId] : [],
      );
      if (targets.length > 0) {
        const related = await tx.legalRequirement.findMany({
          where: {
            id: { in: targets },
            ruleSetVersionId: pins.ruleSetVersionId,
          },
          select: { legalRequirementId: true },
        });
        for (const row of related) legalContextIds.add(row.legalRequirementId);
      }
    }
    const references = ruleDecisionReferences(decision);
    const factIds = [
      ...new Set(
        references.flatMap((r) =>
          r.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT
            ? [r.factId]
            : [],
        ),
      ),
    ];
    const facts = await tx.assessmentCaseFact.findMany({
      where: { assessmentId, factId: { in: factIds } },
      select: {
        factId: true,
        state: true,
        caseRevision: true,
        authority: true,
        evidenceLinks: { select: { evidenceId: true } },
      },
    });
    const evidenceIds = [
      ...new Set([
        ...references.flatMap((r) =>
          r.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
            ? [r.evidenceId]
            : [],
        ),
        ...facts.flatMap((fact) =>
          fact.evidenceLinks.map((link) => link.evidenceId),
        ),
      ]),
    ];
    const evidence = await tx.assessmentEvidence.findMany({
      where: { assessmentId, evidenceId: { in: evidenceIds } },
      select: {
        evidenceId: true,
        state: true,
        repositoryCommit: true,
        repositoryKey: true,
        type: true,
        payload: true,
      },
    });
    return {
      caseRevision: pins.caseRevision,
      pins: {
        ruleSetVersionId: pins.ruleSetVersionId,
        repositorySnapshotId: pins.repositorySnapshotId,
        repositoryCommit: pins.repositoryCommit,
        repositorySetDigest: pins.repositorySetDigest,
        repositories: pins.repositories.map((pin) => ({
          repositoryKey: pin.repositoryKey,
          repositoryCommit: pin.repositoryCommit,
        })),
      },
      rule: rule
        ? {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
            criterionIds: new Set(criterionIdsOf(rule.criteria)),
            legalContextIds,
            declaredElements: new Map(
              rule.legalRequirementLinks.map((link) => [
                link.legalRequirement.legalRequirementId,
                {
                  applicabilityConditions: listLength(
                    link.legalRequirement.applicabilityConditions,
                  ),
                  ...(link.legalRequirement.applicabilityLogic != null
                    ? legalApplicabilityLogicSchema.parse(
                        link.legalRequirement.applicabilityLogic,
                      )
                    : {}),
                  qualifiers: listLength(link.legalRequirement.qualifiers),
                  exceptions: listLength(link.legalRequirement.exceptions),
                  operativeScopes: listLength(
                    link.legalRequirement.operativePropositions,
                  ),
                },
              ]),
            ),
          }
        : null,
      evidence: new Map(evidence.map((row) => [row.evidenceId, row])),
      facts: new Map(
        facts.map((row) => [
          row.factId,
          {
            ...row,
            evidenceIds: row.evidenceLinks.map((link) => link.evidenceId),
          },
        ]),
      ),
    };
  }

  async ruleSetIdentifiers(
    tx: Prisma.TransactionClient,
    ruleSetVersionId: string,
  ): Promise<string[]> {
    const [rules, legal] = await Promise.all([
      tx.assessmentRule.findMany({
        where: { ruleSetVersionId },
        select: { assessmentRuleId: true },
      }),
      tx.legalRequirement.findMany({
        where: { ruleSetVersionId },
        select: { legalRequirementId: true },
      }),
    ]);
    return [
      ...rules.map((r) => r.assessmentRuleId),
      ...legal.map((r) => r.legalRequirementId),
    ];
  }
}
