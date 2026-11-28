import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  DISCOVERY_DETAIL_COLLECTIONS,
  REPOSITORY_SET_ERROR_CODES,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  repositoryDiscoveryExpansionRequestSchema,
  repositoryDiscoveryExpansionResultSchema,
  repositoryDiscoveryRangePageSchema,
  repositoryDiscoveryDetailPageSchema,
  repositoryDiscoverySaveResultSchema,
  repositoryDiscoverySchema,
  repositoryDiscoverySummarySchema,
  submitRepositoryDiscoverySchema,
  type RepositoryDiscovery,
  type RepositoryDiscoveryExpansionRequest,
  type RepositoryDiscoveryExpansionResult,
  type RepositoryDiscoveryRangePage,
  type RepositoryDiscoveryDetailPage,
  type RepositoryDiscoveryDetailPageQuery,
  type RepositoryDiscoverySaveResult,
  type RepositoryDiscoverySummary,
  type SubmitRepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssessmentRecordState,
  AssessmentFactNeedStatus,
  AssessmentFactNeedSubjectKind,
  Prisma,
  RepositoryDiscoveryVersion as PrismaRepositoryDiscoveryVersion,
  RepositoryScannerVersion as PrismaRepositoryScannerVersion,
} from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { canonicalJson } from "../../domain/domain-ids.js";
import { pinsForRepository } from "../../domain/repository-set-pin.js";
import {
  AssessmentCaseSupport,
  type PinnedCase,
} from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "./assessment-runtime-authority.service.js";
import { buildRepositoryDiscoveryRuleCandidates } from "./repository-discovery-rule-matcher.js";

// Read one extra record to detect incomplete recommendation inputs without a costly count.
// Truncation must never silently convert a missing fact into a missing rule candidate.
const MAX_DISCOVERY_MATCH_ACCEPTED_FACTS = 10_000;
const MAX_DISCOVERY_MATCH_RESOLVED_QUESTIONS = 2_000;

type DiscoveryRow = {
  recordId: string;
  assessmentId: string;
  repositorySnapshotId: string;
  repositoryId: string;
  repositoryCommit: string;
  sourcePathPrefix: string | null;
  scannerVersion: string;
  discoveryVersion: string;
  scannerSignature: string;
  graphIndexVersion: string;
  cacheIdentity: string;
  contentDigest: string;
  payload: unknown;
  createdAt: Date;
};

/** Governs immutable repository discovery persistence and bounded leased reads. */
@Injectable()
export class AssessmentRepositoryDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Persist one deterministic repository discovery artifact as an immutable runtime input.
   *
   * Business rules:
   * - A live Root lease and the server-owned assessment snapshot authorize the write.
   * - Repository, snapshot commit, source scope, versions, cache identity, and content digest must all match exactly.
   * - The strict worker contract contains hashes and metadata only; raw source fields and worker-authored rule recommendations are rejected.
   * - The API enriches the verified artifact from pinned rules, ACCEPTED facts, and accepted scoped FactNeed question resolutions without authorizing audit scope.
   * - Oversized accepted-fact/FactNeed inventories fail closed rather than silently dropping facts and giving incomplete candidate rankings.
   * - Replaying the same assessment/cache/content coordinates returns the original record without a second insert.
   *
   * Execution flow:
   * 1. Validate the strict schema, deterministic digest, discovery identity, and cache identity.
   * 2. Authorize the lease and load immutable repository pins in one transaction.
   * 3. Reject any worker coordinate that differs from the server-owned snapshot.
   * 4. Build non-authoritative rule candidates and rule-specific range priorities from pinned API data.
   * 5. Recompute the enriched digest, insert with conflict-safe idempotency, reload the immutable row, and return its receipt.
   *
   * Failure cases:
   * - Malformed payloads, tampered digests/cache identities, invalid leases, or pin/scope mismatches reject before persistence.
   * - A missing post-insert row fails as an integrity error rather than fabricating a receipt.
   *
   * Side effects:
   * - Reads pinned rules and accepted facts and may append one AssessmentRepositoryDiscovery row; valid replays are read-only.
   */
  async save(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    discovery: SubmitRepositoryDiscovery;
  }): Promise<RepositoryDiscoverySaveResult> {
    const parsed = submitRepositoryDiscoverySchema.safeParse(input.discovery);
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const discovery = parsed.data;
    const expectedDigest = computeRepositoryDiscoveryDigest(discovery);
    const expectedCacheIdentity =
      computeRepositoryDiscoveryCacheIdentity(discovery);
    if (
      discovery.contentDigest !== expectedDigest ||
      discovery.discoveryId !== expectedDigest ||
      discovery.cacheIdentity !== expectedCacheIdentity
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      return this.saveAuthorizedInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        discovery,
      });
    });
  }

  /**
   * Business purpose: Persist one validated Discovery artifact after a caller has established either Root or pre-scope discovery authority.
   *
   * Business rules:
   * - The caller must hold the surrounding transaction and authorize the exact assessment before invoking this method.
   * - Repository pins, strict no-raw-source schema, deterministic identity, API-owned rule candidates, and accepted-fact enrichment remain identical for every authority path.
   * - Exact cache/content replay returns the existing immutable row.
   * - A partial accepted-fact or resolved-question inventory cannot be used for candidate matching.
   *
   * Execution flow:
   * 1. Validate the submitted artifact schema, digest, discovery identity, and cache identity.
   * 2. Load current server pins and match every artifact coordinate.
   * 3. Enrich candidates from pinned rules and accepted facts, append the immutable row conflict-safely, and return its receipt.
   *
   * Failure cases:
   * - Invalid content, stale pins, malformed metadata, oversized fact inputs, or a missing post-insert row aborts the caller's transaction.
   *
   * Side effects:
   * - May append one AssessmentRepositoryDiscovery row and reads rules/facts; it never authorizes audit scope or writes evidence, facts, or decisions.
   */
  async saveAuthorizedInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
      discovery: SubmitRepositoryDiscovery;
      /** The pinned repository the artifact must describe; absent means it is matched by its own coordinates. */
      repositoryKey?: string;
    },
  ): Promise<RepositoryDiscoverySaveResult> {
    const parsed = submitRepositoryDiscoverySchema.safeParse(input.discovery);
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const discovery = parsed.data;
    const expectedDigest = computeRepositoryDiscoveryDigest(discovery);
    const expectedCacheIdentity =
      computeRepositoryDiscoveryCacheIdentity(discovery);
    if (
      discovery.contentDigest !== expectedDigest ||
      discovery.discoveryId !== expectedDigest ||
      discovery.cacheIdentity !== expectedCacheIdentity
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const pins = this.pinsForArtifact(
      await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      ),
      discovery,
      input.repositoryKey,
    );
    this.assertArtifactPins(discovery, pins, input.correlationId);
    const [rules, acceptedFacts, resolvedQuestions] = await Promise.all([
      tx.assessmentRule.findMany({
        where: { ruleSetVersionId: pins.ruleSetVersionId },
        orderBy: [{ ordinal: "asc" }, { assessmentRuleId: "asc" }],
        select: {
          assessmentRuleId: true,
          assessmentRuleVersion: true,
          concept: true,
          applicabilityGuidance: true,
          criteria: true,
          contract: true,
          ordinal: true,
        },
      }),
      tx.assessmentCaseFact.findMany({
        where: {
          assessmentId: input.assessmentId,
          state: AssessmentRecordState.ACCEPTED,
        },
        orderBy: [{ caseRevision: "asc" }, { factId: "asc" }],
        take: MAX_DISCOVERY_MATCH_ACCEPTED_FACTS + 1,
        select: { factId: true, statement: true },
      }),
      tx.assessmentFactNeed.findMany({
        where: {
          assessmentId: input.assessmentId,
          subjectKind: AssessmentFactNeedSubjectKind.USE_CASE,
          status: AssessmentFactNeedStatus.RESOLVED,
          predicate: { startsWith: "discovery.question." },
          resolvedFact: { state: AssessmentRecordState.ACCEPTED },
        },
        orderBy: [{ resolvedAt: "desc" }, { factNeedId: "asc" }],
        take: MAX_DISCOVERY_MATCH_RESOLVED_QUESTIONS + 1,
        select: { subjectKey: true, predicate: true },
      }),
    ]);
    if (
      acceptedFacts.length > MAX_DISCOVERY_MATCH_ACCEPTED_FACTS ||
      resolvedQuestions.length > MAX_DISCOVERY_MATCH_RESOLVED_QUESTIONS
    ) {
      // Reject rather than rank recommendations against a misleading partial fact set.
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.BUDGET_EXHAUSTED,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const enriched = buildRepositoryDiscoveryRuleCandidates({
      discovery,
      rules,
      acceptedFacts,
      resolvedQuestions: resolvedQuestions.flatMap((need) => {
        const id = need.subjectKey.startsWith("usecase.")
          ? need.subjectKey.slice("usecase.".length)
          : null;
        const digest = need.predicate.startsWith("discovery.question.")
          ? need.predicate.slice("discovery.question.".length)
          : null;
        return id &&
          /^[a-f0-9]{64}$/.test(id) &&
          digest &&
          /^[a-f0-9]{64}$/.test(digest)
          ? [{ useCaseId: `sha256:${id}`, questionDigest: digest }]
          : [];
      }),
    });
    const inserted = await tx.assessmentRepositoryDiscovery.createMany({
      data: [
        {
          recordId: randomUUID(),
          assessmentId: input.assessmentId,
          repositorySnapshotId: pins.repositorySnapshotId,
          repositoryId: pins.repositoryId,
          repositoryCommit: pins.repositoryCommit.toLowerCase(),
          sourcePathPrefix: pins.sourcePathPrefix,
          scannerVersion: PrismaRepositoryScannerVersion.LCSP_PRE_SCAN_V1,
          discoveryVersion: PrismaRepositoryDiscoveryVersion.LCSP_DISCOVERY_V1,
          scannerSignature: enriched.scannerSignature,
          graphIndexVersion: enriched.graphIndexVersion,
          cacheIdentity: enriched.cacheIdentity,
          contentDigest: enriched.contentDigest,
          payload: enriched,
        },
      ],
      skipDuplicates: true,
    });
    const row = await tx.assessmentRepositoryDiscovery.findUnique({
      where: {
        assessmentId_cacheIdentity_contentDigest: {
          assessmentId: input.assessmentId,
          cacheIdentity: enriched.cacheIdentity,
          contentDigest: enriched.contentDigest,
        },
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
    return repositoryDiscoverySaveResultSchema.parse({
      recordId: row.recordId,
      cacheIdentity: row.cacheIdentity,
      contentDigest: row.contentDigest,
      replayed: inserted.count === 0,
    });
  }

  /**
   * Business purpose: Append an immutable audit event explaining why investigation expanded beyond ranked discovery priorities.
   *
   * Business rules:
   * - A live Root lease and exact current discovery record/digest authorize the event.
   * - Rule IDs must belong to the current authorized audit coverage and priority range IDs must belong to that immutable discovery.
   * - Trace queries are runtime-derived bounded metadata, not evidence.
   * - Expansion never changes the discovery payload, grants audit scope, or confirms production reachability.
   * - The assessment-scoped idempotency key makes an exact retry return the original event.
   *
   * Execution flow:
   * 1. Validate the strict expansion packet and authorize the lease in a transaction.
   * 2. Load the exact current-pin discovery and revalidate its complete integrity contract.
   * 3. Reject foreign priority ranges, append the immutable event conflict-safely, and reload it.
   * 4. Return the stable event identity, creation time, and replay status.
   *
   * Failure cases:
   * - Malformed packets, stale/foreign discovery coordinates, unknown ranges, conflicting idempotent replays, or missing post-insert rows reject without partial writes.
   *
   * Side effects:
   * - May append one AssessmentRepositoryDiscoveryExpansion row; valid replays and all discovery data remain read-only.
   */
  async recordExpansion(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    expansion: RepositoryDiscoveryExpansionRequest;
  }): Promise<RepositoryDiscoveryExpansionResult> {
    const parsed = repositoryDiscoveryExpansionRequestSchema.safeParse(
      input.expansion,
    );
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const expansion = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.pinsForRecordInTx(tx, {
        assessmentId: input.assessmentId,
        recordId: expansion.recordId,
        correlationId: input.correlationId,
      });
      const discoveryRow = await tx.assessmentRepositoryDiscovery.findFirst({
        where: {
          recordId: expansion.recordId,
          contentDigest: expansion.contentDigest,
          ...this.currentPinWhere(input.assessmentId, pins),
        },
      });
      if (!discoveryRow) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const discovery = this.parseVerifiedRow(
        discoveryRow,
        pins,
        input.correlationId,
      );
      await Promise.all(
        [...new Set(expansion.assessmentRuleIds)].map((assessmentRuleId) =>
          this.support.requireCoverage(
            tx,
            input.assessmentId,
            assessmentRuleId,
            input.correlationId,
          ),
        ),
      );
      const rangeIds = new Set(
        discovery.sourceRanges.map((sourceRange) => sourceRange.rangeId),
      );
      if (
        expansion.priorityRangeIds.some((rangeId) => !rangeIds.has(rangeId))
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      const inserted =
        await tx.assessmentRepositoryDiscoveryExpansion.createMany({
          data: [
            {
              expansionId: randomUUID(),
              assessmentId: input.assessmentId,
              repositoryDiscoveryId: discoveryRow.recordId,
              discoveryContentDigest: discoveryRow.contentDigest,
              reasonCode: expansion.reasonCode,
              reason: expansion.reason,
              assessmentRuleIds: expansion.assessmentRuleIds,
              priorityRangeIds: expansion.priorityRangeIds,
              trace: expansion.trace,
              idempotencyKey: expansion.idempotencyKey,
            },
          ],
          skipDuplicates: true,
        });
      const row = await tx.assessmentRepositoryDiscoveryExpansion.findUnique({
        where: {
          assessmentId_idempotencyKey: {
            assessmentId: input.assessmentId,
            idempotencyKey: expansion.idempotencyKey,
          },
        },
      });
      if (!row) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
          input.correlationId,
          { status: HttpStatus.INTERNAL_SERVER_ERROR },
        );
      }
      const requestedEvent = {
        repositoryDiscoveryId: discoveryRow.recordId,
        discoveryContentDigest: discoveryRow.contentDigest,
        reasonCode: expansion.reasonCode,
        reason: expansion.reason,
        assessmentRuleIds: expansion.assessmentRuleIds,
        priorityRangeIds: expansion.priorityRangeIds,
        trace: expansion.trace,
      };
      const storedEvent = {
        repositoryDiscoveryId: row.repositoryDiscoveryId,
        discoveryContentDigest: row.discoveryContentDigest,
        reasonCode: row.reasonCode,
        reason: row.reason,
        assessmentRuleIds: row.assessmentRuleIds,
        priorityRangeIds: row.priorityRangeIds,
        trace: row.trace,
      };
      if (canonicalJson(storedEvent) !== canonicalJson(requestedEvent)) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return repositoryDiscoveryExpansionResultSchema.parse({
        expansionId: row.expansionId,
        recordId: row.repositoryDiscoveryId,
        replayed: inserted.count === 0,
        createdAt: row.createdAt.toISOString(),
      });
    });
  }

  /**
   * Business purpose: Give the leased Root a bounded summary of the newest discovery matching its current repository pins.
   *
   * Business rules:
   * - The current lease and server snapshot scope authorize the read.
   * - Historical or foreign snapshot artifacts are never substituted.
   * - Absence is returned explicitly for legacy/direct assessments and is not evidence that AI use is absent.
   *
   * Execution flow:
   * 1. Authorize the lease and load current pins.
   * 2. Select the newest immutable artifact for the exact assessment/snapshot/repository/commit/scope/version coordinates.
   * 3. Revalidate persisted schema, digest, cache identity and row metadata.
   * 4. Count immutable expansion events and return bounded counts/resource coverage without the full payload.
   *
   * Failure cases:
   * - Invalid leases or pins reject; malformed/tampered persisted data fails integrity validation.
   *
   * Side effects:
   * - Read-only database transaction; no discovery, assessment, or audit state changes.
   */
  async getSummary(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    repositoryKey?: string;
  }): Promise<RepositoryDiscoverySummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.pinsForKeyInTx(tx, input);
      return this.summaryForPinsInTx(tx, pins, input.correlationId);
    });
  }

  /**
   * Business purpose: Expose an owner's already verified pre-scope discovery without granting Root lease access.
   *
   * Business rules:
   * - Only the assessment owner may read; candidate recommendations remain non-authoritative.
   * - An optional record ID restricts the result to the exact discovery run, never an unrelated newer artifact.
   * - The source and rule-set pins must still match the server-owned case.
   *
   * Execution flow:
   * 1. Validate owner identity in the same read transaction.
   * 2. Load current immutable pins and the exact requested discovery record if provided.
   * 3. Reuse the strict integrity-checked bounded Root projection.
   *
   * Failure cases:
   * - Foreign assessment or corrupted discovery fails closed; absence remains explicitly unavailable.
   *
   * Side effects:
   * - Read-only projection; does not create rule selection, evidence, or facts.
   */
  async getOwnerSummary(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
    recordId?: string;
    repositoryKey?: string;
  }): Promise<RepositoryDiscoverySummary> {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.findUnique({
        where: { id: input.assessmentId },
        select: { ownerId: true },
      });
      if (!assessment || assessment.ownerId !== input.ownerId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      // An exact record names its repository itself; otherwise the caller picks a key (default: primary).
      const pins = input.recordId
        ? await this.pinsForRecordInTx(tx, {
            assessmentId: input.assessmentId,
            recordId: input.recordId,
            correlationId: input.correlationId,
          })
        : await this.pinsForKeyInTx(tx, input);
      return this.summaryForPinsInTx(
        tx,
        pins,
        input.correlationId,
        input.recordId,
      );
    });
  }

  /**
   * Business purpose: Share the identical pin-checked, bounded Discovery summary across Root and customer reads.
   *
   * Business rules:
   * - Caller has already established worker-lease or owner authorization.
   * - Exact-pin queries and strict content digests reject cross-assessment or stale source data.
   * - A missing exact record remains unavailable and is never proof of no AI use.
   *
   * Execution flow:
   * 1. Load the pinned artifact and independently verify its integrity.
   * 2. Return only bounded counts and previews with remaining coverage limits.
   *
   * Failure cases:
   * - Integrity, source or digest mismatch rejects; missing artifact is explicitly absent.
   *
   * Side effects:
   * - Read-only DB access.
   */
  private async summaryForPinsInTx(
    tx: Prisma.TransactionClient,
    pins: PinnedCase,
    correlationId: string,
    recordId?: string,
  ): Promise<RepositoryDiscoverySummary> {
    const row = await tx.assessmentRepositoryDiscovery.findFirst({
      where: {
        ...this.currentPinWhere(pins.assessmentId, pins),
        ...(recordId ? { recordId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { recordId: "desc" }],
    });
    if (!row) {
      return repositoryDiscoverySummarySchema.parse({
        available: false,
        discovery: null,
      });
    }
    const discovery = this.parseVerifiedRow(row, pins, correlationId);
    const durableExpansionCount =
      await tx.assessmentRepositoryDiscoveryExpansion.count({
        where: {
          assessmentId: pins.assessmentId,
          repositoryDiscoveryId: row.recordId,
        },
      });
    return repositoryDiscoverySummarySchema.parse({
      available: true,
      discovery: {
        recordId: row.recordId,
        repositoryKey: this.keyOf(pins),
        repositorySnapshotId: row.repositorySnapshotId,
        repositoryId: row.repositoryId,
        repositoryCommit: row.repositoryCommit,
        sourcePathPrefix: row.sourcePathPrefix,
        scannerVersion: row.scannerVersion,
        discoveryVersion: row.discoveryVersion,
        scannerSignature: row.scannerSignature,
        graphIndexVersion: row.graphIndexVersion,
        cacheIdentity: row.cacheIdentity,
        contentDigest: row.contentDigest,
        sourceRangeCount: discovery.sourceRanges.length,
        aiUseCaseCount: discovery.aiUseCases.length,
        ruleCandidateCount: discovery.ruleCandidates.length,
        knownGapCount: discovery.knownGaps.length,
        unsupportedLanguageCount: discovery.unsupportedLanguages.length,
        unresolvedCallCount: discovery.unresolvedCalls.length,
        resourceBudget: discovery.resourceLedger.budget,
        resourceUsage: discovery.resourceLedger.usage,
        remainingBudget: discovery.resourceLedger.remaining,
        coverageImpact: discovery.resourceLedger.coverageImpact,
        expansionCount:
          discovery.resourceLedger.expansionHistory.length +
          durableExpansionCount,
        preview: {
          ranges: discovery.sourceRanges.slice(0, 5).map((range) => ({
            rangeId: range.rangeId,
            path: range.path,
            startLine: range.startLine,
            endLine: range.endLine,
            symbol: range.symbol,
            signalType: range.signalType,
            sourceClassification: range.sourceClassification,
            reachability: range.reachability,
            observationStatus: range.observationStatus,
            evidenceStrength: range.evidenceStrength,
            explanation: range.explanation.slice(0, 500),
            useCaseIds: range.useCaseIds.slice(0, 5),
          })),
          aiUseCases: discovery.aiUseCases.slice(0, 5).map((useCase) => ({
            useCaseId: useCase.useCaseId,
            name: useCase.name,
            observationStatus: useCase.observationStatus,
            providerOrFramework: useCase.providerOrFramework,
            invocationRangeIds: useCase.invocationRangeIds.slice(0, 10),
            unresolvedQuestions: useCase.unresolvedQuestions.slice(0, 5),
          })),
          ruleCandidates: discovery.ruleCandidates
            .slice(0, 5)
            .map((candidate) => ({
              assessmentRuleId: candidate.assessmentRuleId,
              assessmentRuleVersion: candidate.assessmentRuleVersion,
              state: candidate.state,
              supportingUseCaseIds: candidate.supportingUseCaseIds.slice(0, 10),
              supportingRangeIds: candidate.supportingRangeIds.slice(0, 10),
              supportingFactIds: candidate.supportingFactIds.slice(0, 10),
              matchedTerms: candidate.matchedTerms.slice(0, 20),
              applicabilityElements: candidate.applicabilityElements.slice(
                0,
                5,
              ),
              unresolvedConditions: candidate.unresolvedConditions.slice(0, 5),
              rationale: candidate.rationale.slice(0, 1_000),
              limitations: candidate.limitations.slice(0, 5),
              authorizesAssessment: candidate.authorizesAssessment,
            })),
          knownGaps: discovery.knownGaps.slice(0, 5),
          unsupportedLanguages: discovery.unsupportedLanguages.slice(0, 5),
          unresolvedCalls: discovery.unresolvedCalls.slice(0, 5),
        },
        createdAt: row.createdAt.toISOString(),
      },
    });
  }

  /**
   * Business purpose: Page prioritized discovery source ranges without copying the complete artifact into model context.
   *
   * Business rules:
   * - The requested immutable record must belong to the current assessment and exact current snapshot pins.
   * - Pages contain at most one hundred strict RelevanceMap ranges and retain the artifact content digest.
   * - An excessive offset rejects instead of returning a misleading empty page.
   *
   * Execution flow:
   * 1. Authorize the lease and load current pins.
   * 2. Load the requested record under exact pin/version constraints and verify its integrity.
   * 3. Slice the requested range page and return a continuation offset.
   *
   * Failure cases:
   * - Missing/foreign records return PROVENANCE_NOT_FOUND; invalid offsets return REQUEST_INVALID.
   * - Persisted schema, digest, cache, or row mismatches fail integrity validation.
   *
   * Side effects:
   * - Read-only database transaction; paging creates no evidence, facts, decisions, or discovery writes.
   */
  async getRangePage(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    recordId: string;
    offset: number;
    limit: number;
  }): Promise<RepositoryDiscoveryRangePage> {
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.pinsForRecordInTx(tx, input);
      const row = await tx.assessmentRepositoryDiscovery.findFirst({
        where: {
          recordId: input.recordId,
          ...this.currentPinWhere(input.assessmentId, pins),
        },
      });
      if (!row) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const discovery = this.parseVerifiedRow(row, pins, input.correlationId);
      if (input.offset > discovery.sourceRanges.length) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const nextOffset =
        input.offset + input.limit < discovery.sourceRanges.length
          ? input.offset + input.limit
          : null;
      return repositoryDiscoveryRangePageSchema.parse({
        recordId: row.recordId,
        contentDigest: row.contentDigest,
        total: discovery.sourceRanges.length,
        offset: input.offset,
        limit: input.limit,
        nextOffset,
        ranges: discovery.sourceRanges.slice(
          input.offset,
          input.offset + input.limit,
        ),
      });
    });
  }

  /**
   * Business purpose: Page discovery use-case metadata and coverage caveats so the Root can prioritize investigation and fail closed.
   *
   * Business rules:
   * - The immutable record must match the current assessment snapshot and pass full digest/cache validation.
   * - Only AI use cases, non-authoritative rule candidates, known gaps, unsupported languages, and unresolved-call caveats are exposed.
   * - Each page is capped at one hundred items and carries the artifact content digest; no raw source is returned.
   *
   * Execution flow:
   * 1. Authorize the lease, load pins, and select the requested exact record.
   * 2. Verify the stored artifact and select the requested bounded collection.
   * 3. Reject excessive offsets, slice the page, and return its continuation metadata.
   *
   * Failure cases:
   * - Missing/foreign records return PROVENANCE_NOT_FOUND; invalid offsets return REQUEST_INVALID.
   * - Malformed or tampered persisted artifacts fail integrity validation.
   *
   * Side effects:
   * - Read-only database transaction; no discovery, evidence, facts, or decisions are written.
   */
  async getDetailPage(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    recordId: string;
    collection: RepositoryDiscoveryDetailPageQuery["collection"];
    offset: number;
    limit: number;
  }): Promise<RepositoryDiscoveryDetailPage> {
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.pinsForRecordInTx(tx, input);
      return this.detailForPinsInTx(tx, pins, input);
    });
  }

  /**
   * Business purpose: Let the owner inspect every relevant rule candidate in bounded pages.
   * Business rules:
   * - Only the owner of the assessment may read the immutable pin-bound discovery artifact.
   * - The discovery collection is investigative metadata, not a legal decision or audit scope.
   * Execution flow:
   * 1. Validate assessment ownership and current repository pins.
   * 2. Return the same integrity-checked bounded detail page as the worker tool plane.
   * Failure cases:
   * - Foreign, missing or tampered artifacts reject with the standard problem envelope.
   * Side effects:
   * - Read-only customer projection, no fact or audit authorization.
   */
  async getOwnerDetailPage(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
    recordId: string;
    collection: RepositoryDiscoveryDetailPageQuery["collection"];
    offset: number;
    limit: number;
  }): Promise<RepositoryDiscoveryDetailPage> {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.findUnique({
        where: { id: input.assessmentId },
        select: { ownerId: true },
      });
      if (!assessment || assessment.ownerId !== input.ownerId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const pins = await this.pinsForRecordInTx(tx, input);
      return this.detailForPinsInTx(tx, pins, input);
    });
  }

  /**
   * Business purpose: Return one page of verified source/use-case/candidate metadata under the current pins.
   * Business rules:
   * - The caller already holds owner or Root lease authority, and the exact artifact identity is required.
   * - The same semantic projection and page limits apply to both read surfaces.
   * Execution flow:
   * 1. Load exact immutable record and revalidate its digest/source pins.
   * 2. Return a bounded collection page with a continuation cursor.
   * Failure cases:
   * - Missing/tampered artifacts and invalid offsets fail closed.
   * Side effects:
   * - Read-only database projection.
   */
  private async detailForPinsInTx(
    tx: Prisma.TransactionClient,
    pins: PinnedCase,
    input: {
      assessmentId: string;
      correlationId: string;
      recordId: string;
      collection: RepositoryDiscoveryDetailPageQuery["collection"];
      offset: number;
      limit: number;
    },
  ): Promise<RepositoryDiscoveryDetailPage> {
    const row = await tx.assessmentRepositoryDiscovery.findFirst({
      where: {
        recordId: input.recordId,
        ...this.currentPinWhere(input.assessmentId, pins),
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const discovery = this.parseVerifiedRow(row, pins, input.correlationId);
    const items =
      input.collection === DISCOVERY_DETAIL_COLLECTIONS.aiUseCases
        ? discovery.aiUseCases
        : input.collection === DISCOVERY_DETAIL_COLLECTIONS.ruleCandidates
          ? discovery.ruleCandidates
          : input.collection === DISCOVERY_DETAIL_COLLECTIONS.knownGaps
            ? discovery.knownGaps
            : input.collection ===
                DISCOVERY_DETAIL_COLLECTIONS.unsupportedLanguages
              ? discovery.unsupportedLanguages
              : discovery.unresolvedCalls;
    if (input.offset > items.length) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return repositoryDiscoveryDetailPageSchema.parse({
      recordId: row.recordId,
      contentDigest: row.contentDigest,
      collection: input.collection,
      total: items.length,
      offset: input.offset,
      limit: input.limit,
      nextOffset:
        input.offset + input.limit < items.length
          ? input.offset + input.limit
          : null,
      items: items.slice(input.offset, input.offset + input.limit),
    });
  }

  /**
   * Business purpose: Recalculate non-authoritative candidate rules after a customer fact is accepted without rescanning source code.
   * Business rules:
   * - The current assessment pins and exact immutable Discovery record/digest are checked before reuse.
   * - The original scanner observations and Codebase Memory ranges remain unchanged; only API-owned rule suggestions are recomputed.
   * - New candidate revisions remain investigation hints and never select audit scope or establish legal applicability.
   * Execution flow:
   * 1. Verify the original Discovery and strip its derived rule candidates/range-specific matching.
   * 2. Reconstruct a strict worker-format artifact with a deterministic digest.
   * 3. Reuse the existing API-owned matcher and immutable persistence for the newly accepted fact state.
   * Failure cases:
   * - Stale pins, malformed source metadata or invalid derived artifacts abort the caller's transaction.
   * Side effects:
   * - May append one immutable Discovery recommendation revision, without changing source evidence or legal decisions.
   */
  async refreshCandidateRecommendationsInTx(
    tx: Prisma.TransactionClient,
    input: {
      pins: PinnedCase;
      recordId: string;
      correlationId: string;
    },
  ): Promise<RepositoryDiscoverySaveResult> {
    const row = await tx.assessmentRepositoryDiscovery.findFirst({
      where: {
        recordId: input.recordId,
        ...this.currentPinWhere(input.pins.assessmentId, input.pins),
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const discovery = this.parseVerifiedRow(
      row,
      input.pins,
      input.correlationId,
    );
    const raw = {
      ...discovery,
      ruleCandidates: [],
      sourceRanges: discovery.sourceRanges.map((range) => ({
        ...range,
        ruleRelevance: [],
      })),
    };
    const digest = computeRepositoryDiscoveryDigest(raw);
    const workerForm = submitRepositoryDiscoverySchema.parse({
      ...raw,
      contentDigest: digest,
      discoveryId: digest,
    });
    return this.saveAuthorizedInTx(tx, {
      assessmentId: input.pins.assessmentId,
      correlationId: input.correlationId,
      discovery: workerForm,
    });
  }

  /**
   * Business purpose: Bind a proposed pre-scope interview answer to a question that the pinned repository Discovery actually raised.
   * Business rules:
   * - Only the caller holding an owner-authorized assessment transaction may invoke this helper.
   * - The exact immutable Discovery record must match assessment, snapshot, repository, commit, source prefix, schema and digest.
   * - Scanner-authored questions are investigation hints, never verified legal facts or rules.
   * Execution flow:
   * 1. Load and integrity-check the requested Discovery record under the pinned case coordinates.
   * 2. Resolve the exact use-case ID and question string, rejecting caller-invented questions.
   * 3. Return only the authenticated source-range identities and immutable Discovery digest.
   * Failure cases:
   * - Missing/stale/corrupted records or absent questions reject without producing a FactNeed.
   * Side effects:
   * - Read-only transaction helper; no audit scope, fact or decision is created.
   */
  async verifyInterviewQuestionInTx(
    tx: Prisma.TransactionClient,
    input: {
      pins: PinnedCase;
      recordId: string;
      useCaseId: string;
      question: string;
      correlationId: string;
    },
  ): Promise<{ contentDigest: string; rangeIds: string[] }> {
    const row = await tx.assessmentRepositoryDiscovery.findFirst({
      where: {
        recordId: input.recordId,
        ...this.currentPinWhere(input.pins.assessmentId, input.pins),
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const discovery = this.parseVerifiedRow(
      row,
      input.pins,
      input.correlationId,
    );
    const useCase = discovery.aiUseCases.find(
      (item) => item.useCaseId === input.useCaseId,
    );
    if (!useCase || !useCase.unresolvedQuestions.includes(input.question)) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return {
      contentDigest: discovery.contentDigest,
      rangeIds: [
        ...new Set([
          ...useCase.invocationRangeIds,
          ...useCase.inputRangeIds,
          ...useCase.outputRangeIds,
          ...useCase.controlRangeIds,
        ]),
      ].slice(0, 500),
    };
  }

  /**
   * Business purpose: Judge a stored discovery record against the pinned repository it describes, so a record of
   * one repository of the set is never accepted or shown under another repository's snapshot, commit or scope.
   *
   * Business rules:
   * - The record must belong to this assessment; its snapshot decides which pinned repository it is checked against.
   * - A record whose snapshot is not part of the pinned set is treated as absent.
   *
   * Execution flow:
   * 1. Load the verified pin set of the assessment.
   * 2. Read the record's own snapshot id.
   * 3. Return the pins viewed through that repository.
   *
   * Failure cases:
   * - Records that are foreign, missing or no longer pinned raise PROVENANCE_NOT_FOUND (404).
   *
   * Side effects:
   * - Read-only queries.
   */
  private async pinsForRecordInTx(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; recordId: string; correlationId: string },
  ) {
    const pins = await this.support.loadPins(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    const record = await tx.assessmentRepositoryDiscovery.findFirst({
      where: { recordId: input.recordId, assessmentId: input.assessmentId },
      select: { repositorySnapshotId: true },
    });
    const scoped = record
      ? pinsForRepository(pins, { snapshotId: record.repositorySnapshotId })
      : null;
    if (!scoped) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    return scoped;
  }

  /**
   * Business purpose: Select the pinned repository a summary request is about.
   *
   * Business rules:
   * - Without a key the primary repository answers, which keeps single-repository assessments unchanged.
   * - A key must name a repository pinned to the assessment.
   *
   * Execution flow:
   * 1. Load the verified pin set.
   * 2. Return the pins viewed through the requested (or primary) repository.
   *
   * Failure cases:
   * - An unknown key raises REPOSITORY_KEY_UNKNOWN (422).
   *
   * Side effects:
   * - Read-only queries.
   */
  private async pinsForKeyInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
      repositoryKey?: string;
    },
  ) {
    const pins = await this.support.loadPins(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    const key = input.repositoryKey ?? pins.repositories[0]?.repositoryKey;
    const scoped = key ? pinsForRepository(pins, { repositoryKey: key }) : null;
    if (!scoped) {
      throw problemException(
        REPOSITORY_SET_ERROR_CODES.keyUnknown,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return scoped;
  }

  /**
   * Business purpose: Decide which pinned repository a submitted discovery artifact is meant for.
   *
   * Business rules:
   * - An explicit key (a run bound to one repository) wins.
   * - Otherwise the artifact's own repository, commit and source scope identify the pin; nothing matching
   *   falls back to the primary repository so the standard pin-mismatch rejection applies.
   *
   * Execution flow:
   * 1. Use the explicit key when given.
   * 2. Match the artifact coordinates against every pin.
   * 3. Fall back to the primary pin.
   *
   * Failure cases:
   * - None here; assertArtifactPins rejects the chosen pin when the artifact does not match it.
   *
   * Side effects:
   * - Pure selection.
   */
  private pinsForArtifact(
    pins: PinnedCase,
    discovery: RepositoryDiscovery,
    repositoryKey: string | undefined,
  ) {
    const byKey = repositoryKey
      ? pinsForRepository(pins, { repositoryKey })
      : null;
    if (repositoryKey) return byKey ?? this.primaryPins(pins);
    const own = pins.repositories.find(
      (pin) =>
        pin.repositoryId === discovery.repositoryId &&
        pin.repositoryCommit.toLowerCase() ===
          discovery.commitSha.toLowerCase() &&
        pin.sourcePathPrefix === discovery.sourcePathPrefix,
    );
    return (
      (own
        ? pinsForRepository(pins, { repositoryKey: own.repositoryKey })
        : null) ?? this.primaryPins(pins)
    );
  }

  /**
   * Business purpose: View the pins through the primary repository, the default target of single-repository callers.
   * Business rules:
   * - The primary repository is ordinal 0 of the verified set.
   * Execution flow:
   * 1. Project the primary pin into the scalar fields.
   * Failure cases:
   * - A set without members cannot occur; the pins would already have been rejected as not ready.
   * Side effects:
   * - Pure projection.
   */
  private primaryPins(pins: PinnedCase) {
    return {
      ...pins,
      repositoryKey: pins.repositories[0]?.repositoryKey ?? "",
    };
  }

  /**
   * Business purpose: Name the pinned repository a summary describes.
   * Business rules:
   * - The key belongs to the pins the summary was verified against.
   * Execution flow:
   * 1. Read the key when the pins were selected for one repository, else the primary repository's key.
   * Failure cases:
   * - Pins without any repository yield null, which the summary schema accepts for unrecorded legacy sets.
   * Side effects:
   * - Pure projection.
   */
  private keyOf(pins: PinnedCase & { repositoryKey?: string }): string | null {
    return pins.repositoryKey ?? pins.repositories[0]?.repositoryKey ?? null;
  }

  /**
   * Business purpose: Enforce server-owned repository pins before a worker discovery artifact can become durable input.
   *
   * Business rules:
   * - Repository identity, lowercase commit, and nullable source prefix must exactly equal the pinned snapshot.
   * - Only the preserved scanner V1 and discovery V1 contracts are accepted by this service version.
   *
   * Execution flow:
   * 1. Compare repository and commit coordinates.
   * 2. Compare the exact source boundary and supported versions.
   * 3. Return only when every coordinate matches.
   *
   * Failure cases:
   * - Repository/commit/version mismatches raise EVIDENCE_PIN_MISMATCH; source-scope mismatch raises its dedicated problem.
   *
   * Side effects:
   * - Pure validation without persistence or authorization changes.
   */
  private assertArtifactPins(
    discovery: RepositoryDiscovery,
    pins: PinnedCase,
    correlationId: string,
  ): void {
    if (
      discovery.repositoryId !== pins.repositoryId ||
      discovery.commitSha.toLowerCase() !==
        pins.repositoryCommit.toLowerCase() ||
      discovery.scannerVersion !== REPOSITORY_SCANNER_VERSIONS.v1 ||
      discovery.discoveryVersion !== REPOSITORY_DISCOVERY_VERSIONS.v1
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_PIN_MISMATCH,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    if (discovery.sourcePathPrefix !== pins.sourcePathPrefix) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }

  /**
   * Business purpose: Revalidate an immutable discovery row before exposing it to the assessment runtime.
   *
   * Business rules:
   * - Stored JSON must still satisfy the strict no-raw-source discovery schema and deterministic digest/cache contracts.
   * - Every duplicated relational metadata field must equal both the payload and current server-owned pins.
   *
   * Execution flow:
   * 1. Parse the JSON payload and recompute digest and cache identity.
   * 2. Validate payload against current pins.
   * 3. Compare row metadata with the parsed payload and return the verified artifact.
   *
   * Failure cases:
   * - Any malformed, tampered, stale, or cross-coordinate row raises PROVENANCE_INTEGRITY_MISMATCH.
   *
   * Side effects:
   * - Pure validation of already loaded data; no row is repaired or rewritten.
   */
  private parseVerifiedRow(
    row: DiscoveryRow,
    pins: PinnedCase,
    correlationId: string,
  ): RepositoryDiscovery {
    const parsed = repositoryDiscoverySchema.safeParse(row.payload);
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        correlationId,
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
    const discovery = parsed.data;
    const expectedDigest = computeRepositoryDiscoveryDigest(discovery);
    const expectedCacheIdentity =
      computeRepositoryDiscoveryCacheIdentity(discovery);
    try {
      this.assertArtifactPins(discovery, pins, correlationId);
    } catch {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        correlationId,
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
    if (
      row.assessmentId !== pins.assessmentId ||
      row.repositorySnapshotId !== pins.repositorySnapshotId ||
      row.repositoryId !== discovery.repositoryId ||
      row.repositoryCommit.toLowerCase() !==
        discovery.commitSha.toLowerCase() ||
      row.sourcePathPrefix !== discovery.sourcePathPrefix ||
      row.scannerVersion !== discovery.scannerVersion ||
      row.discoveryVersion !== discovery.discoveryVersion ||
      row.scannerSignature !== discovery.scannerSignature ||
      row.graphIndexVersion !== discovery.graphIndexVersion ||
      row.cacheIdentity !== discovery.cacheIdentity ||
      row.contentDigest !== discovery.contentDigest ||
      discovery.contentDigest !== expectedDigest ||
      discovery.discoveryId !== expectedDigest ||
      discovery.cacheIdentity !== expectedCacheIdentity
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        correlationId,
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
    return discovery;
  }

  /**
   * Business purpose: Build the exact current-pin database predicate shared by discovery summary and range reads.
   *
   * Business rules:
   * - Assessment, snapshot, repository, lowercase commit, nullable source scope, and both contract versions are mandatory.
   *
   * Execution flow:
   * 1. Project immutable server pins into a Prisma where object.
   * 2. Add the service-supported scanner and discovery versions.
   *
   * Failure cases:
   * - None; malformed pins were already rejected by AssessmentCaseSupport.
   *
   * Side effects:
   * - Pure object construction without database access.
   */
  private currentPinWhere(assessmentId: string, pins: PinnedCase) {
    return {
      assessmentId,
      repositorySnapshotId: pins.repositorySnapshotId,
      repositoryId: pins.repositoryId,
      repositoryCommit: pins.repositoryCommit.toLowerCase(),
      sourcePathPrefix: pins.sourcePathPrefix,
      scannerVersion: PrismaRepositoryScannerVersion.LCSP_PRE_SCAN_V1,
      discoveryVersion: PrismaRepositoryDiscoveryVersion.LCSP_DISCOVERY_V1,
    } as const;
  }
}
