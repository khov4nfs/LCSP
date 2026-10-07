import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_COMPLETION_BLOCKER_CODES,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_RECORD_STATES,
  DECISION_VALIDATION_FAILURE_CODES,
  type AssessmentCompletionBlocker,
} from "@lcsp/contracts/assessment-domain";
import { Injectable } from "@nestjs/common";
import {
  ArtifactLifecycleState,
  HumanResolutionRequestStatus,
  LegalPortfolioValidationOutcome,
  Prisma,
  RepositoryScanJobStatus,
  RepositorySnapshotStatus,
} from "@prisma/client";

import { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { validateRuleDecision } from "../../domain/decision-validator.js";

const REQUIRED_INPUT_BLOCKER_REASONS: ReadonlySet<string> = new Set([
  BLOCKER_REASONS.REQUIRED_DOCUMENT_UNAVAILABLE,
  BLOCKER_REASONS.REQUIRED_RUNTIME_INPUT_UNAVAILABLE,
]);

export interface AssessmentFinalizationSnapshot {
  caseRevision: number;
  pins: {
    legalPortfolioVersionId: string;
    repositorySnapshotId: string;
    repositoryScanJobId: string;
    repositoryCommit: string;
  };
  decisions: Array<{
    decisionId: string;
    decisionRevision: number;
    decision: RuleDecision;
  }>;
  evidence: Array<{
    evidenceId: string;
    type: string;
    contentSha256: string;
    repositoryCommit: string;
  }>;
  facts: Array<{
    factId: string;
    caseRevision: number;
    kind: string;
    authority: string;
    statement: string;
    evidenceIds: string[];
  }>;
}

export interface AssessmentCompletionInspection {
  lifecycleState: string;
  blockers: AssessmentCompletionBlocker[];
  snapshot: AssessmentFinalizationSnapshot | null;
}

@Injectable()
export class AssessmentCompletionGate {
  constructor(private readonly support: AssessmentCaseSupport) {}

  async inspectInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<AssessmentCompletionInspection> {
    const assessment = await tx.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        lifecycleState: true,
        lifecycleRevision: true,
        blockerReason: true,
        blockerReference: true,
        runtime: {
          select: { executionState: true, currentExecutionId: true },
        },
      },
    });
    if (!assessment?.lifecycleState) {
      return {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
        blockers: [
          {
            code: ASSESSMENT_COMPLETION_BLOCKER_CODES.ASSESSMENT_NOT_ACTIVE,
            reference: assessmentId,
          },
        ],
        snapshot: null,
      };
    }

    const blockers: AssessmentCompletionBlocker[] = [];
    const add = (
      code: AssessmentCompletionBlocker["code"],
      reference: string,
    ) => blockers.push({ code, reference: reference.slice(0, 200) });

    if (
      assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
      assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.FINALIZING
    ) {
      add(
        assessment.lifecycleState ===
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
          ? ASSESSMENT_COMPLETION_BLOCKER_CODES.REQUIRED_INPUT_UNRESOLVED
          : ASSESSMENT_COMPLETION_BLOCKER_CODES.ASSESSMENT_NOT_ACTIVE,
        assessment.lifecycleState,
      );
    }
    if (assessment.blockerReason) {
      add(
        REQUIRED_INPUT_BLOCKER_REASONS.has(assessment.blockerReason)
          ? ASSESSMENT_COMPLETION_BLOCKER_CODES.REQUIRED_INPUT_UNRESOLVED
          : ASSESSMENT_COMPLETION_BLOCKER_CODES.ASSESSMENT_BLOCKED,
        assessment.blockerReason,
      );
    }
    if (
      assessment.runtime?.executionState !== AGENT_EXECUTION_STATES.RUNNING ||
      !assessment.runtime.currentExecutionId
    ) {
      add(ASSESSMENT_COMPLETION_BLOCKER_CODES.EXECUTION_FAILURE, assessmentId);
    }

    const assessmentCase = await tx.assessmentCase.findUnique({
      where: { assessmentId },
      select: {
        caseRevision: true,
        legalPortfolioVersionId: true,
        repositorySnapshotId: true,
        repositoryScanJobId: true,
        repositoryCommit: true,
        pinnedAt: true,
      },
    });
    if (
      !assessmentCase?.legalPortfolioVersionId ||
      !assessmentCase.repositorySnapshotId ||
      !assessmentCase.repositoryScanJobId ||
      !assessmentCase.repositoryCommit ||
      !assessmentCase.pinnedAt
    ) {
      add(ASSESSMENT_COMPLETION_BLOCKER_CODES.PINS_MISSING, assessmentId);
      return this.result(assessment.lifecycleState, blockers, null);
    }

    const pins = {
      legalPortfolioVersionId: assessmentCase.legalPortfolioVersionId,
      repositorySnapshotId: assessmentCase.repositorySnapshotId,
      repositoryScanJobId: assessmentCase.repositoryScanJobId,
      repositoryCommit: assessmentCase.repositoryCommit,
    };

    const [
      portfolio,
      snapshot,
      scanJob,
      rules,
      coverage,
      decisions,
      evidence,
      facts,
      openRequests,
      artifacts,
    ] = await Promise.all([
      tx.legalPortfolioVersion.findUnique({
        where: { id: pins.legalPortfolioVersionId },
        select: { id: true, lifecycleState: true, validationOutcome: true },
      }),
      tx.repositorySnapshot.findUnique({
        where: { id: pins.repositorySnapshotId },
        select: { id: true, assessmentId: true, commitSha: true, status: true },
      }),
      tx.repositoryScanJob.findUnique({
        where: { id: pins.repositoryScanJobId },
        select: {
          id: true,
          assessmentId: true,
          snapshotId: true,
          status: true,
        },
      }),
      tx.engineeringRule.findMany({
        where: { portfolioVersionId: pins.legalPortfolioVersionId },
        select: { engineeringRuleId: true, engineeringRuleVersion: true },
      }),
      tx.assessmentDecisionCoverage.findMany({
        where: { assessmentId },
        select: {
          engineeringRuleId: true,
          portfolioVersionId: true,
          engineeringRuleVersion: true,
          resolutionState: true,
          currentDecisionId: true,
          decisionRevision: true,
        },
      }),
      tx.assessmentRuleDecision.findMany({
        where: { assessmentId },
        orderBy: [{ engineeringRuleId: "asc" }, { decisionRevision: "desc" }],
        select: {
          decisionId: true,
          engineeringRuleId: true,
          engineeringRuleVersion: true,
          scopeId: true,
          portfolioVersionId: true,
          decisionRevision: true,
          state: true,
          repositoryCommit: true,
          caseRevision: true,
          decision: true,
        },
      }),
      tx.assessmentEvidence.findMany({
        where: { assessmentId },
        select: {
          evidenceId: true,
          type: true,
          state: true,
          contentSha256: true,
          repositoryCommit: true,
        },
      }),
      tx.assessmentCaseFact.findMany({
        where: { assessmentId },
        include: { evidenceLinks: { select: { evidenceId: true } } },
      }),
      tx.assessmentHumanRequest.findMany({
        where: {
          assessmentId,
          status: HumanResolutionRequestStatus.OPEN,
        },
        select: { requestId: true },
      }),
      tx.assessmentArtifact.findMany({
        where: { assessmentId, kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT },
        select: { artifactId: true },
      }),
    ]);

    if (
      !portfolio ||
      (portfolio.lifecycleState !== ArtifactLifecycleState.ACTIVE &&
        portfolio.lifecycleState !== ArtifactLifecycleState.SUPERSEDED) ||
      portfolio.validationOutcome !== LegalPortfolioValidationOutcome.PASSED ||
      rules.length === 0
    ) {
      add(
        ASSESSMENT_COMPLETION_BLOCKER_CODES.PORTFOLIO_INVALID,
        pins.legalPortfolioVersionId,
      );
    }
    if (
      !snapshot ||
      snapshot.assessmentId !== assessmentId ||
      snapshot.status !== RepositorySnapshotStatus.READY ||
      snapshot.commitSha.toLowerCase() !==
        pins.repositoryCommit.toLowerCase() ||
      !scanJob ||
      scanJob.assessmentId !== assessmentId ||
      scanJob.snapshotId !== pins.repositorySnapshotId ||
      (scanJob.status !== RepositoryScanJobStatus.QUEUED &&
        scanJob.status !== RepositoryScanJobStatus.RUNNING &&
        scanJob.status !== RepositoryScanJobStatus.COMPLETED)
    ) {
      add(
        ASSESSMENT_COMPLETION_BLOCKER_CODES.REPOSITORY_SNAPSHOT_INVALID,
        pins.repositorySnapshotId,
      );
    }
    for (const request of openRequests) {
      add(
        ASSESSMENT_COMPLETION_BLOCKER_CODES.OPEN_HUMAN_REQUEST,
        request.requestId,
      );
    }
    for (const artifact of artifacts) {
      add(
        ASSESSMENT_COMPLETION_BLOCKER_CODES.INVALID_ARTIFACT_PREREQUISITE,
        artifact.artifactId,
      );
    }

    const coverageByRule = new Map(
      coverage.map((row) => [row.engineeringRuleId, row]),
    );
    const ruleIds = new Set(rules.map((rule) => rule.engineeringRuleId));
    for (const rule of rules) {
      const row = coverageByRule.get(rule.engineeringRuleId);
      if (!row) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.MISSING_RULE_COVERAGE,
          rule.engineeringRuleId,
        );
        continue;
      }
      if (
        row.portfolioVersionId !== pins.legalPortfolioVersionId ||
        row.engineeringRuleVersion !== rule.engineeringRuleVersion
      ) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          rule.engineeringRuleId,
        );
        continue;
      }
      if (row.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED) {
        add(
          row.resolutionState === DECISION_RESOLUTION_STATES.INVALIDATED
            ? ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION
            : ASSESSMENT_COMPLETION_BLOCKER_CODES.DECISION_UNRESOLVED,
          rule.engineeringRuleId,
        );
        continue;
      }
      const accepted = decisions.filter(
        (item) =>
          item.engineeringRuleId === rule.engineeringRuleId &&
          item.state === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      );
      if (accepted.length !== 1 || !row.currentDecisionId) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          rule.engineeringRuleId,
        );
        continue;
      }
      const record = accepted[0];
      if (
        record.decisionId !== row.currentDecisionId ||
        record.decisionRevision !== row.decisionRevision ||
        record.scopeId !== ASSESSMENT_DECISION_SCOPE ||
        record.portfolioVersionId !== pins.legalPortfolioVersionId ||
        record.engineeringRuleVersion !== rule.engineeringRuleVersion ||
        record.repositoryCommit.toLowerCase() !==
          pins.repositoryCommit.toLowerCase() ||
        record.caseRevision !== assessmentCase.caseRevision
      ) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          rule.engineeringRuleId,
        );
        continue;
      }
      const parsed = ruleDecisionSchema.safeParse(record.decision);
      if (!parsed.success) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          rule.engineeringRuleId,
        );
        continue;
      }
      if (parsed.data.engineeringRuleId !== rule.engineeringRuleId) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          rule.engineeringRuleId,
        );
        continue;
      }
      const context = await this.support.buildValidationContext(tx, {
        assessmentId,
        pins: { ...pins, caseRevision: assessmentCase.caseRevision },
        decision: parsed.data,
      });
      const failures = validateRuleDecision(parsed.data, context);
      for (const failure of failures) {
        const code =
          failure.code ===
            DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE ||
          failure.code ===
            DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_NOT_ACCEPTED ||
          failure.code ===
            DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_PIN_MISMATCH
            ? ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_EVIDENCE
            : failure.code ===
                  DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_FACT_REFERENCE ||
                failure.code ===
                  DECISION_VALIDATION_FAILURE_CODES.FACT_NOT_ACCEPTED ||
                failure.code ===
                  DECISION_VALIDATION_FAILURE_CODES.FACT_REVISION_MISMATCH
              ? ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_FACT
              : ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION;
        add(code, failure.ref);
      }
    }
    for (const row of coverage) {
      if (!ruleIds.has(row.engineeringRuleId)) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.EXTRA_RULE_COVERAGE,
          row.engineeringRuleId,
        );
      }
    }
    for (const row of decisions) {
      if (!ruleIds.has(row.engineeringRuleId)) {
        add(
          ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
          row.engineeringRuleId,
        );
      }
    }

    const resolvedDecisions = rules.flatMap((rule) => {
      const row = coverageByRule.get(rule.engineeringRuleId);
      const record = decisions.find(
        (item) => item.decisionId === row?.currentDecisionId,
      );
      if (!record) return [];
      const decision = ruleDecisionSchema.safeParse(record.decision);
      return decision?.success &&
        row?.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED
        ? [
            {
              decisionId: record.decisionId,
              decisionRevision: record.decisionRevision,
              decision: decision.data,
            },
          ]
        : [];
    });

    const evidenceById = new Map(evidence.map((row) => [row.evidenceId, row]));
    const factSnapshots = facts
      .filter((fact) => fact.state === ASSESSMENT_RECORD_STATES.ACCEPTED)
      .map((fact) => ({
        factId: fact.factId,
        caseRevision: fact.caseRevision,
        kind: fact.kind,
        authority: fact.authority,
        statement: fact.statement,
        evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId).sort(),
      }));
    const referencedEvidenceIds = new Set<string>();
    const referencedFactIds = new Set<string>();
    for (const { decision } of resolvedDecisions) {
      for (const reference of [
        ...decision.references,
        ...decision.criteria.flatMap((criterion) => criterion.references),
      ]) {
        if (
          reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
        ) {
          referencedEvidenceIds.add(reference.evidenceId);
        } else {
          referencedFactIds.add(reference.factId);
        }
      }
    }
    const finalizationSnapshot: AssessmentFinalizationSnapshot = {
      caseRevision: assessmentCase.caseRevision,
      pins,
      decisions: resolvedDecisions,
      evidence: [...referencedEvidenceIds].sort().flatMap((evidenceId) => {
        const record = evidenceById.get(evidenceId);
        return record?.state === ASSESSMENT_RECORD_STATES.ACCEPTED
          ? [
              {
                evidenceId,
                type: record.type,
                contentSha256: record.contentSha256,
                repositoryCommit: record.repositoryCommit,
              },
            ]
          : [];
      }),
      facts: factSnapshots.filter((fact) => referencedFactIds.has(fact.factId)),
    };
    return this.result(
      assessment.lifecycleState,
      blockers,
      blockers.length === 0 ? finalizationSnapshot : null,
    );
  }

  private result(
    lifecycleState: string,
    blockers: AssessmentCompletionBlocker[],
    snapshot: AssessmentFinalizationSnapshot | null,
  ): AssessmentCompletionInspection {
    const unique = new Map(
      blockers.map((blocker) => [
        `${blocker.code}:${blocker.reference ?? ""}`,
        blocker,
      ]),
    );
    return {
      lifecycleState,
      blockers: [...unique.values()].sort(
        (left, right) =>
          left.code.localeCompare(right.code) ||
          (left.reference ?? "").localeCompare(right.reference ?? ""),
      ),
      snapshot,
    };
  }
}
