import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  DISCOVERY_DETAIL_COLLECTIONS,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  repositoryDiscoveryRangePageSchema,
  repositoryDiscoveryDetailPageSchema,
  repositoryDiscoverySaveResultSchema,
  repositoryDiscoverySchema,
  repositoryDiscoverySummarySchema,
  type RepositoryDiscovery,
  type RepositoryDiscoveryRangePage,
  type RepositoryDiscoveryDetailPage,
  type RepositoryDiscoveryDetailPageQuery,
  type RepositoryDiscoverySaveResult,
  type RepositoryDiscoverySummary,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  RepositoryDiscoveryVersion as PrismaRepositoryDiscoveryVersion,
  RepositoryScannerVersion as PrismaRepositoryScannerVersion,
} from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  AssessmentCaseSupport,
  type PinnedCase,
} from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "./assessment-runtime-authority.service.js";

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
   * - The strict discovery contract contains hashes and metadata only; raw source fields are rejected.
   * - Replaying the same assessment/cache/content coordinates returns the original record without a second insert.
   *
   * Execution flow:
   * 1. Validate the strict schema, deterministic digest, discovery identity, and cache identity.
   * 2. Authorize the lease and load immutable repository pins in one transaction.
   * 3. Reject any worker coordinate that differs from the server-owned snapshot.
   * 4. Insert with conflict-safe idempotency, reload the immutable row, and return its receipt.
   *
   * Failure cases:
   * - Malformed payloads, tampered digests/cache identities, invalid leases, or pin/scope mismatches reject before persistence.
   * - A missing post-insert row fails as an integrity error rather than fabricating a receipt.
   *
   * Side effects:
   * - May append one AssessmentRepositoryDiscovery row; valid replays are read-only.
   */
  async save(input: {
    assessmentId: string;
    leaseToken: string;
    correlationId: string;
    discovery: RepositoryDiscovery;
  }): Promise<RepositoryDiscoverySaveResult> {
    const parsed = repositoryDiscoverySchema.safeParse(input.discovery);
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
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      this.assertArtifactPins(discovery, pins, input.correlationId);

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
            discoveryVersion:
              PrismaRepositoryDiscoveryVersion.LCSP_DISCOVERY_V1,
            scannerSignature: discovery.scannerSignature,
            graphIndexVersion: discovery.graphIndexVersion,
            cacheIdentity: discovery.cacheIdentity,
            contentDigest: discovery.contentDigest,
            payload: discovery,
          },
        ],
        skipDuplicates: true,
      });
      const row = await tx.assessmentRepositoryDiscovery.findUnique({
        where: {
          assessmentId_cacheIdentity_contentDigest: {
            assessmentId: input.assessmentId,
            cacheIdentity: discovery.cacheIdentity,
            contentDigest: discovery.contentDigest,
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
   * 4. Return counts and resource coverage only, without source ranges or the full payload.
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
  }): Promise<RepositoryDiscoverySummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const row = await tx.assessmentRepositoryDiscovery.findFirst({
        where: this.currentPinWhere(input.assessmentId, pins),
        orderBy: [{ createdAt: "desc" }, { recordId: "desc" }],
      });
      if (!row) {
        return repositoryDiscoverySummarySchema.parse({
          available: false,
          discovery: null,
        });
      }
      const discovery = this.parseVerifiedRow(row, pins, input.correlationId);
      return repositoryDiscoverySummarySchema.parse({
        available: true,
        discovery: {
          recordId: row.recordId,
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
          knownGapCount: discovery.knownGaps.length,
          unsupportedLanguageCount: discovery.unsupportedLanguages.length,
          unresolvedCallCount: discovery.unresolvedCalls.length,
          resourceBudget: discovery.resourceLedger.budget,
          resourceUsage: discovery.resourceLedger.usage,
          remainingBudget: discovery.resourceLedger.remaining,
          coverageImpact: discovery.resourceLedger.coverageImpact,
          expansionCount: discovery.resourceLedger.expansionHistory.length,
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
            knownGaps: discovery.knownGaps.slice(0, 5),
            unsupportedLanguages: discovery.unsupportedLanguages.slice(0, 5),
            unresolvedCalls: discovery.unresolvedCalls.slice(0, 5),
          },
          createdAt: row.createdAt.toISOString(),
        },
      });
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
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
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
   * - Only AI use cases, known gaps, unsupported languages, and unresolved-call caveats are exposed.
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
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
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
    });
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
