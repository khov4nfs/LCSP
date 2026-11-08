import { createHash, randomUUID } from "node:crypto";
import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
  HttpStatus,
} from "@nestjs/common";
import {
  Prisma,
  AuthoredLocalizationLocale,
  AuthoredLocalizationState,
  AuthoredSourceLanguage,
  type AuthoredLocalizationRequest,
  type AuthoredLocalizedRevision,
} from "@prisma/client";
import {
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_OPERATIONAL_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
  AUTHORED_CANDIDATE_ACTIONS,
  authoredTranslationResponseSchema,
  type AuthoredLocalizationEntity,
  type AuthoredLocalizationOperationalState,
  type AuthoredLocalizationReadinessState,
  type AuthoredLocalizationCounts,
  type AuthoredBatchSourceReview,
  type AuthoredBatchOutputReview,
  type AuthoredCandidateAction,
  localizedReportArtifactSchema,
  LOCALIZED_REPORT_SCHEMA_VERSION,
  AUTHORED_LANGUAGE_REVIEW_CODES,
  authoredSourceReviewSchema,
  authoredOutputReviewSchema,
  authoredBatchReviewResultSchema,
  authoredLocalizationBacklogResponseSchema,
  AUTHORED_SOURCE_LANGUAGES,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../http/filters/error.factory.js";
import type { z } from "zod";

/**
 * Business purpose: Fingerprint exact authored content or artifact text.
 *
 * Business rules:
 * - Use UTF-8 SHA-256 without altering the canonical source.
 * Execution flow:
 * 1. Hash the supplied text and return its digest.
 * Failure cases:
 * - Invalid input types fail instead of producing a guessed origin hash.
 * Side effects:
 * - None: pure content hashing.
 */
const digest = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
/**
 * Business purpose: Serialize canonical localization bindings deterministically.
 *
 * Business rules:
 * - Object keys are ordered while arrays and scalar values retain their identity.
 * Execution flow:
 * 1. Normalize object key ordering during JSON serialization.
 * Failure cases:
 * - Unsupported or cyclic data cannot produce a valid canonical binding.
 * Side effects:
 * - None: returns serialized data without mutating its source.
 */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

/**
 * Business purpose: Require trusted language evidence before treating persisted localized bytes as available.
 * Business rules:
 * - Verified native targets must be exact canonical copies; all other targets require explicit output review.
 * Execution flow:
 * 1. Check persisted state/revision and apply the matching native-copy or reviewed-output proof.
 * Failure cases:
 * - Missing proof, legacy native paraphrases and absent revisions remain unavailable.
 * Side effects:
 * - None: record-level language readiness only; callers separately verify content hashes.
 */
export function hasReviewedLocale(
  row: Pick<
    AuthoredLocalizationRequest,
    | "state"
    | "sourceLanguage"
    | "locale"
    | "sourceReviewedBy"
    | "sourceReviewedAt"
    | "translationReviewedBy"
    | "translationReviewedAt"
    | "originalContent"
  > & {
    revision: Pick<AuthoredLocalizedRevision, "content" | "engine"> | null;
  },
): boolean {
  if (row.state !== AuthoredLocalizationState.READY || !row.revision)
    return false;
  if (
    row.sourceReviewedBy &&
    row.sourceReviewedAt &&
    row.sourceLanguage === row.locale
  )
    return (
      row.revision.engine === "CANONICAL_ORIGINAL" &&
      row.revision.content === row.originalContent
    );
  return Boolean(row.translationReviewedBy && row.translationReviewedAt);
}
const authoredKeys = new Set([
  "title",
  "concept",
  "proposition",
  "legalIntent",
  "applicabilityGuidance",
  "applicabilityConditions",
  "qualifiers",
  "exceptions",
  "nonAssessableReason",
  "description",
  "investigationFocus",
  "investigationGoals",
  "rationale",
  "summary",
  "analysisSummary",
  "workSummary",
  "recommendations",
  "question",
  "unresolvedFact",
  "decisionImpact",
  "resolutionAttempts",
  "label",
  "normativeStatement",
  "actionPlan",
  "scopeLimitations",
]);
const protectedKeys = new Set([
  "sources",
  "sourceRefs",
  "sourceSupport",
  "support",
  "quote",
  "quotation",
  "quotes",
  "evidence",
  "references",
  "answers",
  "answer",
  "facts",
  "acceptedFacts",
  "factIndex",
  "evidenceIndex",
  "repositoryPath",
  "storageRef",
]);

/**
 * Business purpose: Identify authored business narratives eligible for localization.
 *
 * Business rules:
 * - Protected legal sources, evidence, accepted facts and customer answers remain excluded; IDs and enums are not narrative fields.
 * Execution flow:
 * 1. Walk whitelisted fields and nested values while recording escaped JSON-pointer paths.
 * Failure cases:
 * - Malformed non-object values yield no eligible fields; traversal never converts evidence into instructions.
 * Side effects:
 * - None: read-only extraction of text and field identity.
 */
export function authoredFields(
  value: unknown,
  path = "",
  inherited = false,
): Array<{ path: string; text: string }> {
  if (typeof value === "string")
    return inherited && value.trim() ? [{ path, text: value }] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      authoredFields(item, `${path}/${index}`, inherited),
    );
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    protectedKeys.has(key)
      ? []
      : authoredFields(
          item,
          `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`,
          authoredKeys.has(key) ||
            (key === "statement" &&
              /\/(?:criteria|criteriaDecisions)\/\d+$/u.test(path)),
        ),
  );
}

/**
 * Business purpose: Classify the current operational state of one localization request.
 * Business rules:
 * - Only verified native copies or reviewed outputs are READY; candidate/mixed/unknown/provider states remain distinct.
 * Execution flow:
 * 1. Inspect persisted state, source review, candidate/revision presence and failure metadata.
 * Failure cases:
 * - Unreviewed or failed work never classifies as READY.
 * Side effects:
 * - None: pure classification of persisted fields.
 */
export function deriveOperationalState(
  row: Pick<
    AuthoredLocalizationRequest,
    | "state"
    | "sourceLanguage"
    | "locale"
    | "sourceReviewedBy"
    | "sourceReviewedAt"
    | "translationReviewedBy"
    | "translationReviewedAt"
    | "originalContent"
    | "errorCode"
    | "attempts"
  > & {
    candidate?: { contentSha256: string } | null;
    revision: Pick<AuthoredLocalizedRevision, "content" | "engine"> | null;
  },
): AuthoredLocalizationOperationalState {
  if (hasReviewedLocale(row))
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY;
  if (row.state === AuthoredLocalizationState.FAILED)
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.FAILED;
  if (
    row.candidate ||
    row.revision ||
    row.errorCode === AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED
  )
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.OUTPUT_REVIEW_REQUIRED;
  if (row.sourceLanguage === AuthoredSourceLanguage.MIXED)
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.MIXED_SOURCE;
  if (!row.sourceReviewedBy && row.sourceLanguage === AuthoredSourceLanguage.UNKNOWN)
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.UNKNOWN_SOURCE;
  if (!row.sourceReviewedBy)
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.SOURCE_REVIEW_REQUIRED;
  if (
    row.attempts > 0 &&
    (row.errorCode === AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED ||
      row.errorCode === AUTHORED_LOCALIZATION_CODES.PROVIDER_UNAVAILABLE ||
      row.errorCode === AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID)
  )
    return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_FAILED;
  return AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_PENDING;
}

const emptyCounts = (): AuthoredLocalizationCounts => ({
  UNKNOWN_SOURCE: 0,
  MIXED_SOURCE: 0,
  SOURCE_REVIEW_REQUIRED: 0,
  PROVIDER_PENDING: 0,
  PROVIDER_FAILED: 0,
  OUTPUT_REVIEW_REQUIRED: 0,
  READY: 0,
  FAILED: 0,
});

function accumulateJobCounts(
  counts: AuthoredLocalizationCounts,
  row: Parameters<typeof deriveOperationalState>[0],
) {
  if (hasReviewedLocale(row)) {
    counts.READY += 1;
    return;
  }
  if (row.state === AuthoredLocalizationState.FAILED) counts.FAILED += 1;
  if (row.sourceLanguage === AuthoredSourceLanguage.UNKNOWN)
    counts.UNKNOWN_SOURCE += 1;
  if (row.sourceLanguage === AuthoredSourceLanguage.MIXED)
    counts.MIXED_SOURCE += 1;
  if (!row.sourceReviewedBy) counts.SOURCE_REVIEW_REQUIRED += 1;
  if (
    row.candidate ||
    row.revision ||
    row.sourceLanguage === AuthoredSourceLanguage.MIXED ||
    row.errorCode === AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED
  )
    counts.OUTPUT_REVIEW_REQUIRED += 1;
  if (
    row.attempts > 0 &&
    !row.candidate &&
    (row.state === AuthoredLocalizationState.FAILED ||
      row.errorCode === AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED ||
      row.errorCode === AUTHORED_LOCALIZATION_CODES.PROVIDER_UNAVAILABLE ||
      row.errorCode === AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID)
  )
    counts.PROVIDER_FAILED += 1;
  if (
    row.state === AuthoredLocalizationState.PENDING &&
    row.sourceReviewedBy &&
    (row.sourceLanguage === AuthoredSourceLanguage.EN ||
      row.sourceLanguage === AuthoredSourceLanguage.VI) &&
    !row.candidate
  )
    counts.PROVIDER_PENDING += 1;
}

/**
 * Business purpose: Queue both locale variants of one canonical document revision.
 *
 * Business rules:
 * - Idempotency binds scope, entity, revision, canonical digest, field and locale; canonical records remain unchanged.
 * - Unverified EN/VI hints are rejected; verifiedSourceEvidence requires matching SHA-256, actorId and evidence.
 * Execution flow:
 * 1. Hash the document and each authored field, then upsert EN/VI requests in the caller transaction.
 * Failure cases:
 * - Database failures or unverified EN/VI declarations abort the transaction; no provider output or original language is guessed.
 * Side effects:
 * - Insert durable translation jobs (and verified review evidence when supplied) without calling a model.
 */
export async function enqueueAuthoredDocument(
  tx: Prisma.TransactionClient,
  input: {
    scopeId: string;
    entityType: AuthoredLocalizationEntity;
    entityId: string;
    canonicalRevision: string;
    document: unknown;
    /** Upstream may flag MIXED/UNKNOWN; EN/VI require the hash-bound source-review command or verifiedSourceEvidence. */
    sourceLanguages?: Readonly<Record<string, AuthoredSourceLanguage>>;
    verifiedSourceEvidence?: Readonly<
      Record<
        string,
        {
          sourceLanguage: AuthoredSourceLanguage;
          originSha256: string;
          actorId: string;
          evidence: string;
        }
      >
    >;
  },
) {
  const canonicalDigest = digest(canonicalJson(input.document));
  for (const field of authoredFields(input.document)) {
    const originSha256 = digest(field.text);
    const declared = input.sourceLanguages?.[field.path];
    const verified = input.verifiedSourceEvidence?.[field.path];
    if (
      (declared === AuthoredSourceLanguage.EN ||
        declared === AuthoredSourceLanguage.VI) &&
      (!verified ||
        verified.sourceLanguage !== declared ||
        verified.originSha256 !== originSha256 ||
        !verified.actorId.trim() ||
        verified.evidence.trim().length < 10)
    )
      throw problemException(
        AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
        randomUUID(),
        { status: HttpStatus.CONFLICT },
      );
    if (
      verified &&
      (verified.originSha256 !== originSha256 ||
        !verified.actorId.trim() ||
        verified.evidence.trim().length < 10 ||
        (verified.sourceLanguage !== AuthoredSourceLanguage.EN &&
          verified.sourceLanguage !== AuthoredSourceLanguage.VI))
    )
      throw problemException(
        AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
        randomUUID(),
        { status: HttpStatus.CONFLICT },
      );
    const effectiveSourceLanguage =
      verified?.sourceLanguage ??
      declared ??
      AuthoredSourceLanguage.UNKNOWN;
    const now = new Date();
    for (const locale of [
      AuthoredLocalizationLocale.EN,
      AuthoredLocalizationLocale.VI,
    ]) {
      const idempotencyKey = digest(
        canonicalJson([
          input.scopeId,
          input.entityType,
          input.entityId,
          input.canonicalRevision,
          canonicalDigest,
          field.path,
          locale,
          1,
        ]),
      );
      const row = await tx.authoredLocalizationRequest.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          id: randomUUID(),
          idempotencyKey,
          scopeId: input.scopeId,
          entityType: input.entityType,
          entityId: input.entityId,
          canonicalRevision: input.canonicalRevision,
          canonicalDigest,
          fieldPath: field.path,
          locale,
          sourceLanguage: effectiveSourceLanguage,
          sourceReviewedBy: verified ? verified.actorId.trim() : null,
          sourceReviewedAt: verified ? now : null,
          originalLanguage: verified
            ? verified.sourceLanguage === AuthoredSourceLanguage.EN
              ? AuthoredLocalizationLocale.EN
              : AuthoredLocalizationLocale.VI
            : null,
          errorCode: verified
            ? null
            : AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
          originalContent: field.text,
          originSha256,
        },
      });
      if (verified) {
        const existingReview = await tx.authoredLocalizationReview.findFirst({
          where: { requestId: row.id },
        });
        if (!existingReview) {
          await tx.authoredLocalizationReview.create({
            data: {
              id: randomUUID(),
              requestId: row.id,
              actorId: verified.actorId.trim(),
              evidence: verified.evidence.trim(),
              binding: {
                scopeId: input.scopeId,
                entityType: input.entityType,
                entityId: input.entityId,
                canonicalRevision: input.canonicalRevision,
                canonicalDigest,
                fieldPath: field.path,
                originSha256,
                sourceLanguage: verified.sourceLanguage,
              },
            },
          });
        }
      }
    }
  }
}

/** Durable bounded translation poller. Provider invocation is opt-in deployment configuration. */
@Injectable()
export class AuthoredLocalizationService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Page durable localization work requiring authorized language review.
   * Business rules:
   * - Caller must be an authorized administrator; scope is explicit and canonical content is read-only.
   * Execution flow:
   * 1. Read a bounded stable page with candidate, immutable revision and review evidence.
   * Failure cases:
   * - Invalid bounds or database failures reject without changing queue state.
   * Side effects:
   * - Reads jobs only; also serves as restart-safe historical reconciliation discovery.
   */
  async reviewQueue(scopeId: string, after?: string, limit = 100) {
    if (!scopeId || limit < 1 || limit > 200)
      throw problemException(
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
        randomUUID(),
        { status: HttpStatus.CONFLICT },
      );
    const rows = await this.prisma.authoredLocalizationRequest.findMany({
      where: { scopeId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        scopeId: true,
        entityType: true,
        entityId: true,
        canonicalRevision: true,
        canonicalDigest: true,
        fieldPath: true,
        translationRevision: true,
        createdAt: true,
        locale: true,
        originalLanguage: true,
        originalContent: true,
        originSha256: true,
        sourceLanguage: true,
        sourceReviewedBy: true,
        sourceReviewedAt: true,
        translationReviewedBy: true,
        translationReviewedAt: true,
        state: true,
        errorCode: true,
        attempts: true,
        nextAttemptAt: true,
        candidate: true,
        revision: true,
        reviews: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      entityType: AUTHORED_LOCALIZATION_ENTITIES[row.entityType],
      state: AUTHORED_LOCALIZATION_STATES[row.state],
      operationalState: deriveOperationalState(row),
      sourceLanguage: AUTHORED_SOURCE_LANGUAGES[row.sourceLanguage],
      locale: row.locale === AuthoredLocalizationLocale.EN ? "en" : "vi",
      originalLanguage:
        row.originalLanguage === AuthoredLocalizationLocale.EN
          ? "en"
          : row.originalLanguage === AuthoredLocalizationLocale.VI
            ? "vi"
            : null,
    }));
  }

  /**
   * Business purpose: Discover operational localization backlog across scopes without requiring a caller-supplied scopeId.
   * Business rules:
   * - Bounded pagination and deterministic ordering prevent unbounded scans; provider credentials are never exposed.
   * Execution flow:
   * 1. Discover distinct scope IDs in ascending order, load their latest field-locale jobs, and compute derived operational counts and readiness.
   * Failure cases:
   * - Invalid bounds or unsupported entityType filters reject with an explicit conflict.
   * Side effects:
   * - Read-only query over persisted localization tables.
   */
  async backlog(
    afterScopeId?: string,
    entityType?: AuthoredLocalizationEntity,
    limit = 25,
  ) {
    if (
      limit < 1 ||
      limit > 50 ||
      (entityType !== undefined &&
        !(entityType in AUTHORED_LOCALIZATION_ENTITIES))
    )
      throw problemException(
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
        randomUUID(),
        { status: HttpStatus.CONFLICT },
      );
    const scopeRows = await this.prisma.authoredLocalizationRequest.findMany({
      where: {
        ...(afterScopeId ? { scopeId: { gt: afterScopeId } } : {}),
        ...(entityType ? { entityType } : {}),
      },
      distinct: ["scopeId"],
      orderBy: { scopeId: "asc" },
      take: limit + 1,
      select: { scopeId: true },
    });
    const hasMore = scopeRows.length > limit;
    const pageScopes = scopeRows.slice(0, limit).map((row) => row.scopeId);
    const nextAfterScopeId = hasMore
      ? (pageScopes[pageScopes.length - 1] ?? null)
      : null;
    const rows = pageScopes.length
      ? await this.prisma.authoredLocalizationRequest.findMany({
          where: {
            scopeId: { in: pageScopes },
            ...(entityType ? { entityType } : {}),
          },
          orderBy: [
            { scopeId: "asc" },
            { translationRevision: "desc" },
            { id: "asc" },
          ],
          include: { candidate: true, revision: true },
        })
      : [];
    const latestByScope = new Map<string, Map<string, (typeof rows)[number]>>();
    for (const scopeId of pageScopes) latestByScope.set(scopeId, new Map());
    for (const row of rows) {
      const scopeMap = latestByScope.get(row.scopeId);
      if (!scopeMap) continue;
      const key = JSON.stringify([
        row.entityType,
        row.entityId,
        row.canonicalRevision,
        row.canonicalDigest,
        row.fieldPath,
        row.locale,
      ]);
      if (!scopeMap.has(key)) scopeMap.set(key, row);
    }
    const nowMs = Date.now();
    const totalCounts = emptyCounts();
    let totalPending = 0;
    let oldestPendingAgeSeconds = 0;
    let totalRetries = 0;
    let totalFailed = 0;
    let candidateReviewsAwaitingAction = 0;
    let sourceReviewsAwaitingAction = 0;
    const scopes = pageScopes.map((scopeId) => {
      const scopeJobs = [...(latestByScope.get(scopeId)?.values() ?? [])];
      const counts = emptyCounts();
      const entities = new Set<AuthoredLocalizationEntity>();
      let scopePending = 0;
      let scopeOldestAgeSeconds = 0;
      let scopeRetries = 0;
      const byLocale = {
        en: [] as typeof scopeJobs,
        vi: [] as typeof scopeJobs,
      };
      for (const job of scopeJobs) {
        entities.add(AUTHORED_LOCALIZATION_ENTITIES[job.entityType]);
        accumulateJobCounts(counts, job);
        accumulateJobCounts(totalCounts, job);
        if (job.locale === AuthoredLocalizationLocale.EN)
          byLocale.en.push(job);
        else byLocale.vi.push(job);
        if (job.attempts > 1) {
          const retries = job.attempts - 1;
          scopeRetries += retries;
          totalRetries += retries;
        }
        if (!hasReviewedLocale(job)) {
          if (job.state === AuthoredLocalizationState.FAILED) {
            totalFailed += 1;
          } else {
            scopePending += 1;
            totalPending += 1;
            const ageSeconds = Math.max(
              0,
              Math.floor((nowMs - job.createdAt.getTime()) / 1000),
            );
            if (ageSeconds > scopeOldestAgeSeconds)
              scopeOldestAgeSeconds = ageSeconds;
            if (ageSeconds > oldestPendingAgeSeconds)
              oldestPendingAgeSeconds = ageSeconds;
          }
          if (!job.sourceReviewedBy) sourceReviewsAwaitingAction += 1;
          if (
            job.candidate ||
            job.revision ||
            job.sourceLanguage === AuthoredSourceLanguage.MIXED ||
            job.errorCode === AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED
          )
            candidateReviewsAwaitingAction += 1;
        }
      }
      const readinessFor = (
        localeJobs: typeof scopeJobs,
      ): AuthoredLocalizationReadinessState => {
        if (!localeJobs.length)
          return AUTHORED_LOCALIZATION_READINESS_STATES.PENDING;
        if (localeJobs.every((job) => hasReviewedLocale(job)))
          return AUTHORED_LOCALIZATION_READINESS_STATES.READY;
        if (
          localeJobs.some(
            (job) =>
              !hasReviewedLocale(job) &&
              job.state === AuthoredLocalizationState.FAILED,
          )
        )
          return AUTHORED_LOCALIZATION_READINESS_STATES.FAILED;
        if (
          localeJobs.some(
            (job) =>
              !hasReviewedLocale(job) &&
              (!job.sourceReviewedBy ||
                job.sourceLanguage === AuthoredSourceLanguage.MIXED ||
                Boolean(job.candidate) ||
                Boolean(job.revision) ||
                job.errorCode ===
                  AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED),
          )
        )
          return AUTHORED_LOCALIZATION_READINESS_STATES.REVIEW_REQUIRED;
        return AUTHORED_LOCALIZATION_READINESS_STATES.PENDING;
      };
      return {
        scopeId,
        entityTypes: [...entities].sort(),
        counts,
        readiness: {
          en: readinessFor(byLocale.en),
          vi: readinessFor(byLocale.vi),
        },
        pendingJobCount: scopePending,
        oldestPendingAgeSeconds: scopeOldestAgeSeconds,
        retryCount: scopeRetries,
      };
    });
    return authoredLocalizationBacklogResponseSchema.parse({
      counts: totalCounts,
      operations: {
        pendingJobCount: totalPending,
        oldestPendingAgeSeconds,
        retryCount: totalRetries,
        failedJobCount: totalFailed,
        candidateReviewsAwaitingAction,
        sourceReviewsAwaitingAction,
        workerEnabled:
          process.env.LCSP_AUTHORED_TRANSLATION_WORKER_ENABLED === "1",
        providerConfigured: Boolean(
          process.env.LCSP_AUTHORED_TRANSLATION_URL &&
            process.env.LCSP_AUTHORED_TRANSLATION_KEY,
        ),
        batchLimit: 50,
        workerLeaseLimit: 5,
        maxAttempts: 5,
        reviewSlaTargetMinutes: 60,
        processingSlaTargetMinutes: 15,
      },
      scopes,
      nextAfterScopeId,
    });
  }

  /**
   * Business purpose: Compute customer-safe localization readiness for one scope and target locale.
   * Business rules:
   * - Never leaks reviewer identities or provider internals; returns READY only when all latest field jobs for the locale are reviewed.
   * Execution flow:
   * 1. Load latest requests for the scope and target locale and classify readiness.
   * Failure cases:
   * - Missing or unreviewed jobs return PENDING, FAILED or REVIEW_REQUIRED rather than READY.
   * Side effects:
   * - Read-only query.
   */
  async scopeReadiness(
    scopeId: string,
    locale: string | null,
  ): Promise<AuthoredLocalizationReadinessState> {
    if (!locale) return AUTHORED_LOCALIZATION_READINESS_STATES.READY;
    const target =
      locale === "vi"
        ? AuthoredLocalizationLocale.VI
        : AuthoredLocalizationLocale.EN;
    const rows = await this.prisma.authoredLocalizationRequest.findMany({
      where: { scopeId, locale: target },
      orderBy: [{ translationRevision: "desc" }, { id: "asc" }],
      include: { candidate: true, revision: true },
    });
    if (!rows.length) return AUTHORED_LOCALIZATION_READINESS_STATES.PENDING;
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = JSON.stringify([
        row.entityType,
        row.entityId,
        row.canonicalRevision,
        row.canonicalDigest,
        row.fieldPath,
        row.locale,
      ]);
      if (!latest.has(key)) latest.set(key, row);
    }
    const jobs = [...latest.values()];
    if (jobs.every((job) => hasReviewedLocale(job)))
      return AUTHORED_LOCALIZATION_READINESS_STATES.READY;
    if (
      jobs.some(
        (job) =>
          !hasReviewedLocale(job) &&
          job.state === AuthoredLocalizationState.FAILED,
      )
    )
      return AUTHORED_LOCALIZATION_READINESS_STATES.FAILED;
    if (
      jobs.some(
        (job) =>
          !hasReviewedLocale(job) &&
          (!job.sourceReviewedBy ||
            job.sourceLanguage === AuthoredSourceLanguage.MIXED ||
            Boolean(job.candidate) ||
            Boolean(job.revision) ||
            job.errorCode === AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED),
      )
    )
      return AUTHORED_LOCALIZATION_READINESS_STATES.REVIEW_REQUIRED;
    return AUTHORED_LOCALIZATION_READINESS_STATES.PENDING;
  }

  /**
   * Business purpose: Attach reviewed language provenance to one exact authored field and both target jobs.
   * Business rules:
   * - Hash, revision and scope must match; an active lease or conflicting prior review rejects; language is never inferred.
   * Execution flow:
   * 1. Lock the bound field jobs, verify original bytes, append review evidence and release eligible pending work.
   * Failure cases:
   * - Stale inputs, changed bytes and conflicting reviews abort the entire transaction.
   * Side effects:
   * - Appends review evidence and updates job provenance without rewriting canonical content or localized revisions.
   */
  async reviewSource(
    scopeId: string,
    requestId: string,
    body: z.infer<typeof authoredSourceReviewSchema>,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.authoredLocalizationRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      if (
        job.scopeId !== scopeId ||
        job.originSha256 !== body.originSha256 ||
        job.canonicalRevision !== body.canonicalRevision ||
        digest(job.originalContent) !== job.originSha256
      )
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          { status: HttpStatus.CONFLICT },
        );
      const siblings = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AuthoredLocalizationRequest" WHERE "scopeId"=${scopeId} AND "entityType"=${job.entityType}::"AuthoredLocalizationEntity" AND "entityId"=${job.entityId} AND "canonicalRevision"=${job.canonicalRevision} AND "canonicalDigest"=${job.canonicalDigest} AND "fieldPath"=${job.fieldPath} AND "originSha256"=${job.originSha256} ORDER BY "id" FOR UPDATE`,
      );
      for (const sibling of siblings) {
        const current = await tx.authoredLocalizationRequest.findUniqueOrThrow({
          where: { id: sibling.id },
        });
        if (
          current.leaseToken ||
          (current.sourceReviewedBy &&
            current.sourceLanguage !== body.sourceLanguage)
        )
          throw problemException(
            AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
            randomUUID(),
            { status: HttpStatus.CONFLICT },
          );
        const nativeRevision =
          body.sourceLanguage === current.locale
            ? await tx.authoredLocalizedRevision.findUnique({
                where: { requestId: current.id },
              })
            : null;
        if (
          current.sourceReviewedBy &&
          (!nativeRevision ||
            (nativeRevision.content === current.originalContent &&
              nativeRevision.engine === "CANONICAL_ORIGINAL"))
        )
          continue;
        if (!current.sourceReviewedBy) {
          await tx.authoredLocalizationReview.create({
            data: {
              id: randomUUID(),
              requestId: current.id,
              actorId,
              evidence: body.evidence,
              binding: {
                scopeId,
                entityType: current.entityType,
                entityId: current.entityId,
                canonicalRevision: current.canonicalRevision,
                canonicalDigest: current.canonicalDigest,
                fieldPath: current.fieldPath,
                originSha256: current.originSha256,
                sourceLanguage: body.sourceLanguage,
              },
            },
          });
          await tx.authoredLocalizationRequest.update({
            where: { id: current.id },
            data: {
              sourceLanguage: body.sourceLanguage,
              sourceReviewedBy:
                body.sourceLanguage === AuthoredSourceLanguage.EN ||
                body.sourceLanguage === AuthoredSourceLanguage.VI
                  ? actorId
                  : null,
              sourceReviewedAt:
                body.sourceLanguage === AuthoredSourceLanguage.EN ||
                body.sourceLanguage === AuthoredSourceLanguage.VI
                  ? new Date()
                  : null,
              originalLanguage:
                body.sourceLanguage === AuthoredSourceLanguage.EN
                  ? AuthoredLocalizationLocale.EN
                  : body.sourceLanguage === AuthoredSourceLanguage.VI
                    ? AuthoredLocalizationLocale.VI
                    : null,
              nextAttemptAt: new Date(),
              errorCode: AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
            },
          });
        }
        // Preserve historical accepted bytes and publish a new native-copy revision
        // rather than relabeling an earlier provider paraphrase as the original.
        if (
          nativeRevision &&
          (nativeRevision.content !== current.originalContent ||
            nativeRevision.engine !== "CANONICAL_ORIGINAL")
        ) {
          const latest = await tx.authoredLocalizationRequest.findFirstOrThrow({
            where: {
              scopeId,
              entityType: current.entityType,
              entityId: current.entityId,
              canonicalRevision: current.canonicalRevision,
              canonicalDigest: current.canonicalDigest,
              fieldPath: current.fieldPath,
              originSha256: current.originSha256,
              locale: current.locale,
            },
            orderBy: { translationRevision: "desc" },
          });
          if (latest.id === current.id) {
            const nextId = randomUUID();
            await tx.authoredLocalizationRequest.create({
              data: {
                id: nextId,
                idempotencyKey: digest(
                  canonicalJson([
                    current.idempotencyKey,
                    "verified-native-copy",
                    current.translationRevision + 1,
                  ]),
                ),
                scopeId,
                entityType: current.entityType,
                entityId: current.entityId,
                canonicalRevision: current.canonicalRevision,
                canonicalDigest: current.canonicalDigest,
                fieldPath: current.fieldPath,
                locale: current.locale,
                originalLanguage: current.locale,
                sourceLanguage: body.sourceLanguage,
                sourceReviewedBy: actorId,
                sourceReviewedAt: new Date(),
                originalContent: current.originalContent,
                originSha256: current.originSha256,
                translationRevision: current.translationRevision + 1,
              },
            });
            await tx.authoredLocalizationReview.create({
              data: {
                id: randomUUID(),
                requestId: nextId,
                actorId,
                evidence: body.evidence,
                binding: {
                  scopeId,
                  entityType: current.entityType,
                  entityId: current.entityId,
                  canonicalRevision: current.canonicalRevision,
                  canonicalDigest: current.canonicalDigest,
                  fieldPath: current.fieldPath,
                  originSha256: current.originSha256,
                  sourceLanguage: body.sourceLanguage,
                  supersedesRequestId: current.id,
                },
              },
            });
          }
        }
      }
      return { reviewed: siblings.length };
    });
  }

  /**
   * Business purpose: Publish an explicitly reviewed target-language candidate or derived normalization.
   * Business rules:
   * - Exact original and output hashes bind approval; accepted localized bytes are immutable; authorization belongs to the Admin boundary.
   * Execution flow:
   * 1. Lock the request, validate candidate or normalization, append reviewer evidence and atomically publish its revision.
   * Failure cases:
   * - Foreign scope, stale hashes, active leases or attempts to replace accepted content reject without publication.
   * Side effects:
   * - Persists an immutable derived revision and review audit; never changes canonical source bytes.
   */
  async reviewOutput(
    scopeId: string,
    requestId: string,
    body: z.infer<typeof authoredOutputReviewSchema>,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "AuthoredLocalizationRequest" WHERE "id"=${requestId} FOR UPDATE`,
      );
      const job = await tx.authoredLocalizationRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { candidate: true, revision: true, reviews: true },
      });
      const candidateRejected = job.reviews.some(
        (review) =>
          (review.binding as { action?: string } | null)?.action ===
          AUTHORED_CANDIDATE_ACTIONS.REJECT,
      );
      if (candidateRejected && body.normalizedContent === undefined)
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          { status: HttpStatus.CONFLICT },
        );
      let output =
        body.normalizedContent !== undefined
          ? {
              content: body.normalizedContent,
              engine: "REVIEWED_NORMALIZATION",
              engineVersion: "1",
            }
          : (job.revision ?? job.candidate);
      if (
        job.sourceReviewedBy &&
        job.sourceLanguage === job.locale &&
        output?.content !== job.originalContent
      )
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          { status: HttpStatus.CONFLICT },
        );
      if (
        job.sourceReviewedBy &&
        job.sourceReviewedAt &&
        job.sourceLanguage === job.locale &&
        !job.revision &&
        output?.content === job.originalContent
      )
        output = {
          content: job.originalContent,
          engine: "CANONICAL_ORIGINAL",
          engineVersion: "1",
        };
      if (
        !output ||
        job.scopeId !== scopeId ||
        job.leaseToken ||
        job.originSha256 !== body.originSha256 ||
        digest(job.originalContent) !== job.originSha256 ||
        digest(output.content) !== body.contentSha256 ||
        (job.revision && job.revision.content !== output.content)
      )
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          { status: HttpStatus.CONFLICT },
        );
      if (job.translationReviewedBy)
        return { state: AUTHORED_LOCALIZATION_STATES.READY };
      await tx.authoredLocalizationReview.create({
        data: {
          id: randomUUID(),
          requestId,
          actorId,
          evidence: body.evidence,
          binding: {
            scopeId,
            entityType: job.entityType,
            entityId: job.entityId,
            canonicalRevision: job.canonicalRevision,
            canonicalDigest: job.canonicalDigest,
            fieldPath: job.fieldPath,
            originSha256: job.originSha256,
            locale: job.locale,
            contentSha256: body.contentSha256,
            normalized: body.normalizedContent !== undefined,
          },
        },
      });
      if (!job.revision)
        await tx.authoredLocalizedRevision.create({
          data: {
            id: randomUUID(),
            requestId,
            content: output.content,
            engine: output.engine,
            engineVersion: output.engineVersion,
            contentSha256: body.contentSha256,
          },
        });
      await tx.authoredLocalizationRequest.update({
        where: { id: requestId },
        data: {
          state: AuthoredLocalizationState.READY,
          translationReviewedBy: actorId,
          translationReviewedAt: new Date(),
          errorCode: null,
        },
      });
      return { state: AUTHORED_LOCALIZATION_STATES.READY };
    });
  }

  /**
   * Business purpose: Apply bounded human-reviewed source-language attestations across up to 50 field items.
   * Business rules:
   * - Requires explicit individual-field attestation; each item validates its own exact SHA-256 and revision and records immutable review evidence.
   * - Partial batch failures report accepted and rejected items truthfully without silent acceptance.
   * Execution flow:
   * 1. Iterate bounded items, execute reviewSource per item and collect itemized outcomes.
   * Failure cases:
   * - Stale hashes, foreign scope or conflicting reviews reject only the invalid item and report its errorCode.
   * Side effects:
   * - Appends immutable review evidence and updates provenance for valid items.
   */
  async batchReviewSource(
    scopeId: string,
    body: AuthoredBatchSourceReview,
    actorId: string,
  ) {
    const results: Array<{
      requestId: string;
      accepted: boolean;
      errorCode: string | null;
    }> = [];
    let acceptedCount = 0;
    let rejectedCount = 0;
    for (const item of body.items) {
      try {
        await this.reviewSource(
          scopeId,
          item.requestId,
          {
            originSha256: item.originSha256,
            canonicalRevision: item.canonicalRevision,
            sourceLanguage: item.sourceLanguage,
            evidence: body.evidence,
          },
          actorId,
        );
        acceptedCount += 1;
        results.push({
          requestId: item.requestId,
          accepted: true,
          errorCode: null,
        });
      } catch {
        rejectedCount += 1;
        results.push({
          requestId: item.requestId,
          accepted: false,
          errorCode: AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
        });
      }
    }
    return authoredBatchReviewResultSchema.parse({
      scopeId,
      acceptedCount,
      rejectedCount,
      results,
    });
  }

  /**
   * Business purpose: Apply bounded human-reviewed output attestations across up to 50 candidate or normalized items.
   * Business rules:
   * - Requires explicit target-language and meaning confirmation; each item validates its exact origin and output SHA-256.
   * - Partial batch failures report accepted and rejected items truthfully without silent acceptance.
   * Execution flow:
   * 1. Iterate bounded items, execute reviewOutput per item and collect itemized outcomes.
   * Failure cases:
   * - Stale hashes, rejected candidates without normalization or foreign scope reject the invalid item.
   * Side effects:
   * - Publishes immutable localized revisions and review audit rows for valid items.
   */
  async batchReviewOutput(
    scopeId: string,
    body: AuthoredBatchOutputReview,
    actorId: string,
  ) {
    const results: Array<{
      requestId: string;
      accepted: boolean;
      errorCode: string | null;
    }> = [];
    let acceptedCount = 0;
    let rejectedCount = 0;
    for (const item of body.items) {
      try {
        await this.reviewOutput(
          scopeId,
          item.requestId,
          {
            originSha256: item.originSha256,
            contentSha256: item.contentSha256,
            ...(item.normalizedContent !== undefined
              ? { normalizedContent: item.normalizedContent }
              : {}),
            confirmsTargetLanguageAndMeaning: true,
            evidence: body.evidence,
          },
          actorId,
        );
        acceptedCount += 1;
        results.push({
          requestId: item.requestId,
          accepted: true,
          errorCode: null,
        });
      } catch {
        rejectedCount += 1;
        results.push({
          requestId: item.requestId,
          accepted: false,
          errorCode: AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
        });
      }
    }
    return authoredBatchReviewResultSchema.parse({
      scopeId,
      acceptedCount,
      rejectedCount,
      results,
    });
  }

  /**
   * Business purpose: Reject an invalid provider candidate or request a controlled retry on a failed/pending localization job.
   * Business rules:
   * - Canonical source bytes and accepted READY revisions are never mutated; candidate/review rows remain append-only.
   * - Rejecting a candidate records immutable rejection evidence and marks the candidate's job FAILED.
   * - Retrying a job with an existing immutable candidate creates a superseding translationRevision; retrying a candidate-free failed job resets its attempt counter.
   * Execution flow:
   * 1. Lock the target request, verify scope/revision/originSha256 and ensure it is not already an accepted READY revision.
   * 2. Record immutable review evidence and transition or supersede the request according to action.
   * Failure cases:
   * - Foreign scope, stale hashes, active leases or already-accepted READY revisions reject with a conflict.
   * Side effects:
   * - Appends review audit and updates or creates a pending localization request revision.
   */
  async retryOrRejectCandidate(
    scopeId: string,
    requestId: string,
    body: AuthoredCandidateAction,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "AuthoredLocalizationRequest" WHERE "id"=${requestId} FOR UPDATE`,
      );
      const job = await tx.authoredLocalizationRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { candidate: true, revision: true },
      });
      if (
        job.scopeId !== scopeId ||
        job.leaseToken ||
        job.originSha256 !== body.originSha256 ||
        job.canonicalRevision !== body.canonicalRevision ||
        digest(job.originalContent) !== job.originSha256 ||
        hasReviewedLocale(job) ||
        job.revision !== null
      )
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          { status: HttpStatus.CONFLICT },
        );
      if (body.action === AUTHORED_CANDIDATE_ACTIONS.REJECT) {
        if (
          !job.candidate ||
          (body.candidateSha256 &&
            job.candidate.contentSha256 !== body.candidateSha256)
        )
          throw problemException(
            AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
            randomUUID(),
            { status: HttpStatus.CONFLICT },
          );
        await tx.authoredLocalizationReview.create({
          data: {
            id: randomUUID(),
            requestId: job.id,
            actorId,
            evidence: body.evidence,
            binding: {
              scopeId,
              entityType: job.entityType,
              entityId: job.entityId,
              canonicalRevision: job.canonicalRevision,
              canonicalDigest: job.canonicalDigest,
              fieldPath: job.fieldPath,
              originSha256: job.originSha256,
              locale: job.locale,
              action: AUTHORED_CANDIDATE_ACTIONS.REJECT,
              rejectedCandidateSha256: job.candidate.contentSha256,
            },
          },
        });
        await tx.authoredLocalizationRequest.update({
          where: { id: job.id },
          data: {
            state: AuthoredLocalizationState.FAILED,
            errorCode: AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          },
        });
        return {
          id: job.id,
          state: AUTHORED_LOCALIZATION_STATES.FAILED,
          translationRevision: job.translationRevision,
        };
      }
      if (job.candidate) {
        await tx.authoredLocalizationRequest.update({
          where: { id: job.id },
          data: {
            state: AuthoredLocalizationState.FAILED,
            errorCode: AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          },
        });
        const latest = await tx.authoredLocalizationRequest.findFirstOrThrow({
          where: {
            scopeId,
            entityType: job.entityType,
            entityId: job.entityId,
            canonicalRevision: job.canonicalRevision,
            canonicalDigest: job.canonicalDigest,
            fieldPath: job.fieldPath,
            originSha256: job.originSha256,
            locale: job.locale,
          },
          orderBy: { translationRevision: "desc" },
        });
        const nextRevision = latest.translationRevision + 1;
        const nextId = randomUUID();
        await tx.authoredLocalizationRequest.create({
          data: {
            id: nextId,
            idempotencyKey: digest(
              canonicalJson([
                job.idempotencyKey,
                "controlled-retry",
                nextRevision,
              ]),
            ),
            scopeId,
            entityType: job.entityType,
            entityId: job.entityId,
            canonicalRevision: job.canonicalRevision,
            canonicalDigest: job.canonicalDigest,
            fieldPath: job.fieldPath,
            locale: job.locale,
            originalLanguage: job.originalLanguage,
            sourceLanguage: job.sourceLanguage,
            sourceReviewedBy: job.sourceReviewedBy,
            sourceReviewedAt: job.sourceReviewedAt,
            originalContent: job.originalContent,
            originSha256: job.originSha256,
            translationRevision: nextRevision,
            state: AuthoredLocalizationState.PENDING,
            attempts: 0,
            nextAttemptAt: new Date(),
            errorCode: job.sourceReviewedBy
              ? null
              : AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
          },
        });
        await tx.authoredLocalizationReview.create({
          data: {
            id: randomUUID(),
            requestId: nextId,
            actorId,
            evidence: body.evidence,
            binding: {
              scopeId,
              entityType: job.entityType,
              entityId: job.entityId,
              canonicalRevision: job.canonicalRevision,
              canonicalDigest: job.canonicalDigest,
              fieldPath: job.fieldPath,
              originSha256: job.originSha256,
              locale: job.locale,
              action: AUTHORED_CANDIDATE_ACTIONS.RETRY,
              supersedesRequestId: job.id,
            },
          },
        });
        return {
          id: nextId,
          state: AUTHORED_LOCALIZATION_STATES.PENDING,
          translationRevision: nextRevision,
        };
      }
      await tx.authoredLocalizationReview.create({
        data: {
          id: randomUUID(),
          requestId: job.id,
          actorId,
          evidence: body.evidence,
          binding: {
            scopeId,
            entityType: job.entityType,
            entityId: job.entityId,
            canonicalRevision: job.canonicalRevision,
            canonicalDigest: job.canonicalDigest,
            fieldPath: job.fieldPath,
            originSha256: job.originSha256,
            locale: job.locale,
            action: AUTHORED_CANDIDATE_ACTIONS.RETRY,
            previousAttempts: job.attempts,
            previousState: job.state,
          },
        },
      });
      await tx.authoredLocalizationRequest.update({
        where: { id: job.id },
        data: {
          state: AuthoredLocalizationState.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          errorCode: job.sourceReviewedBy
            ? null
            : AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
        },
      });
      return {
        id: job.id,
        state: AUTHORED_LOCALIZATION_STATES.PENDING,
        translationRevision: job.translationRevision,
      };
    });
  }

  /**
   * Business purpose: Start the explicitly enabled durable translation poller.
   *
   * Business rules:
   * - Provider work is deployment opt-in and cannot be triggered by GET requests.
   * Execution flow:
   * 1. Check worker configuration and schedule bounded queue draining.
   * Failure cases:
   * - Polling failures remain recorded by the job lifecycle rather than replacing canonical content.
   * Side effects:
   * - Register an unreferenced periodic timer when enabled.
   */
  onModuleInit() {
    if (process.env.LCSP_AUTHORED_TRANSLATION_WORKER_ENABLED !== "1") return;
    this.timer = setInterval(() => {
      void this.drain().catch(() => undefined);
    }, 1000);
    this.timer.unref();
  }
  /**
   * Business purpose: Stop this API process from polling translation jobs during shutdown.
   *
   * Business rules:
   * - Other replicas retain access to durable jobs and immutable revisions.
   * Execution flow:
   * 1. Clear the existing poll timer when present.
   * Failure cases:
   * - No timer is a safe no-op.
   * Side effects:
   * - Cancel the process-local polling schedule without deleting persistent work.
   */
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Business purpose: Lease bounded pending translation work safely across replicas.
   *
   * Business rules:
   * - Expired exhausted jobs fail explicitly; SKIP LOCKED leasing and lease tokens prevent competing acceptance.
   * Execution flow:
   * 1. Mark exhausted jobs, lease due requests and process the claimed jobs concurrently.
   * Failure cases:
   * - Database errors propagate; the running guard is released even on failure.
   * Side effects:
   * - Update persistent leases, attempts and job outcomes; may call the translation provider.
   */
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const token = randomUUID();
      await this.prisma.authoredLocalizationRequest.updateMany({
        where: {
          state: AuthoredLocalizationState.PENDING,
          attempts: { gte: 5 },
          candidate: { is: null },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        data: {
          state: AuthoredLocalizationState.FAILED,
          errorCode: AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        UPDATE "AuthoredLocalizationRequest" SET "leaseToken"=${token}, "leaseUntil"=NOW()+INTERVAL '60 seconds', "attempts"="attempts"+1
        WHERE "id" IN (SELECT "id" FROM "AuthoredLocalizationRequest"
          WHERE "state"='PENDING' AND "nextAttemptAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())
          AND "sourceReviewedBy" IS NOT NULL AND "sourceLanguage" IN ('EN','VI')
          AND NOT EXISTS (SELECT 1 FROM "AuthoredTranslationCandidate" candidate WHERE candidate."requestId"="AuthoredLocalizationRequest"."id")
          ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING "id"`);
      await Promise.all(rows.map((row) => this.translate(row.id, token)));
    } finally {
      this.running = false;
    }
  }

  /**
   * Business purpose: Persist one leased translation result or its bounded retry state.
   *
   * Business rules:
   * - Only the current lease may accept output; exact origin/locale and provider metadata are required; READY revisions are immutable.
   * Execution flow:
   * 1. Load the claimed job, obtain verified output, then commit READY plus revision or record retry/failure.
   * Failure cases:
   * - Provider configuration, timeout, schema or digest failures retain explicit PENDING/FAILED state with bounded retries.
   * Side effects:
   * - Call the configured provider and transact immutable revisions and job status.
   */
  private async translate(id: string, token: string) {
    const job = await this.prisma.authoredLocalizationRequest.findUniqueOrThrow(
      { where: { id } },
    );
    if (job.leaseToken !== token) return;
    try {
      if (digest(job.originalContent) !== job.originSha256)
        throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
      if (
        !job.sourceReviewedBy ||
        !job.sourceReviewedAt ||
        (job.sourceLanguage !== AuthoredSourceLanguage.EN &&
          job.sourceLanguage !== AuthoredSourceLanguage.VI)
      ) {
        await this.prisma.authoredLocalizationRequest.updateMany({
          where: { id, leaseToken: token },
          data: {
            leaseToken: null,
            leaseUntil: null,
            errorCode: AUTHORED_LANGUAGE_REVIEW_CODES.SOURCE_REQUIRED,
          },
        });
        return;
      }
      const locale = job.locale === AuthoredLocalizationLocale.EN ? "en" : "vi";
      let result: { content: string; engine: string; engineVersion: string };
      if (job.sourceLanguage === job.locale)
        result = {
          content: job.originalContent,
          engine: "CANONICAL_ORIGINAL",
          engineVersion: "1",
        };
      else {
        const url = process.env.LCSP_AUTHORED_TRANSLATION_URL;
        const key = process.env.LCSP_AUTHORED_TRANSLATION_KEY;
        if (!url || !key)
          throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_UNAVAILABLE);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            locale,
            originalLanguage: job.sourceLanguage,
            content: job.originalContent,
            originSha256: job.originSha256,
          }),
        });
        if (!response.ok)
          throw new Error(AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED);
        const parsed = authoredTranslationResponseSchema.parse(
          await response.json(),
        );
        if (
          parsed.locale !== locale ||
          parsed.originSha256 !== job.originSha256 ||
          parsed.engine === "CANONICAL_ORIGINAL" ||
          parsed.engine === "REVIEWED_NORMALIZATION"
        )
          throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
        result = {
          content: parsed.content,
          engine: parsed.engine,
          engineVersion: parsed.engineVersion,
        };
        // Provider self-labels establish mechanics, not linguistic equivalence.
        // Freeze a candidate and require an authenticated independent review.
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.authoredLocalizationRequest.updateMany({
            where: {
              id,
              leaseToken: token,
              state: AuthoredLocalizationState.PENDING,
            },
            data: {
              leaseToken: null,
              leaseUntil: null,
              errorCode: AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED,
            },
          });
          if (claimed.count)
            await tx.authoredTranslationCandidate.upsert({
              where: { requestId: id },
              update: {},
              create: {
                requestId: id,
                ...result,
                contentSha256: digest(result.content),
              },
            });
        });
        return;
      }
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.authoredLocalizationRequest.updateMany({
          where: {
            id,
            leaseToken: token,
            state: AuthoredLocalizationState.PENDING,
          },
          data: {
            state: AuthoredLocalizationState.READY,
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
        if (!claimed.count) return;
        await tx.authoredLocalizedRevision.create({
          data: {
            id: randomUUID(),
            requestId: id,
            ...result,
            contentSha256: digest(result.content),
          },
        });
      });
    } catch {
      await this.prisma.authoredLocalizationRequest.updateMany({
        where: { id, leaseToken: token },
        data: {
          state:
            job.attempts >= 5
              ? AuthoredLocalizationState.FAILED
              : AuthoredLocalizationState.PENDING,
          errorCode: AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600, 2 ** job.attempts) * 1000,
          ),
        },
      });
    }
  }

  /**
   * Business purpose: Read a consistent requested-language translation for every authored string.
   *
   * Business rules:
   * - The caller authorizes scope; version bindings and exact origin hashes constrain reuse; ambiguous or missing revisions cannot fall back.
   * Execution flow:
   * 1. Load matching locale revisions, verify readiness and content hashes, then assemble the result map.
   * Failure cases:
   * - Missing, failed, inconsistent or corrupt translations raise an explicit localization conflict.
   * Side effects:
   * - Read persisted translation records only; no provider calls or cache writes.
   */
  async project(
    texts: string[],
    locale: string,
    scopeId: string,
    binding?: {
      entityId: string;
      entityType?: AuthoredLocalizationEntity;
      canonicalDigest?: string;
      canonicalRevision?: string;
      fieldPath?: string;
      translationRevision?: number;
    },
  ): Promise<Map<string, string>> {
    if (locale !== "en" && locale !== "vi")
      throw new Error("Unsupported localization locale");
    const requested = [...new Set(texts.filter((text) => text.trim()))];
    const target =
      locale === "en"
        ? AuthoredLocalizationLocale.EN
        : AuthoredLocalizationLocale.VI;
    const rows = await this.prisma.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        locale: target,
        ...(binding ?? {}),
        originSha256: { in: requested.map(digest) },
      },
      include: { revision: true },
    });
    const result = new Map<string, string>();
    for (const text of requested) {
      const candidates = rows.filter(
        (row) =>
          row.originSha256 === digest(text) &&
          (!binding?.fieldPath || row.fieldPath === binding.fieldPath) &&
          (!binding?.translationRevision ||
            row.translationRevision === binding.translationRevision),
      );
      const latestRevision = Math.max(
        0,
        ...candidates.map((row) => row.translationRevision),
      );
      const matches = candidates.filter(
        (row) => row.translationRevision === latestRevision,
      );
      const ready = matches.filter(
        (row) =>
          hasReviewedLocale(row) &&
          digest(row.originalContent) === row.originSha256,
      );
      const variants = new Set(ready.map((row) => row.revision!.contentSha256));
      if (
        variants.size > 1 ||
        ready.some(
          (row) =>
            digest(row.revision!.content) !== row.revision!.contentSha256,
        )
      ) {
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          {
            status: HttpStatus.CONFLICT,
            meta: { locale, state: AUTHORED_LOCALIZATION_STATES.FAILED },
          },
        );
      }
      if (!ready.length) {
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
          randomUUID(),
          {
            status: HttpStatus.CONFLICT,
            meta: {
              locale,
              state: matches.some(
                (row) => row.state === AuthoredLocalizationState.FAILED,
              )
                ? AUTHORED_LOCALIZATION_STATES.FAILED
                : AUTHORED_LOCALIZATION_STATES.PENDING,
            },
          },
        );
      }
      result.set(text, ready[0].revision!.content);
    }
    for (const text of texts) if (!text.trim()) result.set(text, text);
    return result;
  }

  /**
   * Business purpose: Resolve path-addressed reviewed translations for one bound canonical document.
   *
   * Business rules:
   * - Every field resolves only from its exact JSON-pointer path, scope, entity, canonical revision/digest, locale, and origin hash.
   * - Two fields with identical canonical text may legitimately carry distinct path-specific reviewed translations without cross-path substitution.
   * Execution flow:
   * 1. Query localization rows bound to the scope, entity, canonical revision/digest, locale, and extracted paths/hashes.
   * 2. Verify each path's latest reviewed revision, original content hash, and translated content hash independently.
   * Failure cases:
   * - Missing/pending/failed paths fail closed with INCOMPLETE; corrupt or conflicting revisions at the same path fail with PROVIDER_INVALID.
   * Side effects:
   * - Read persisted translation records only; no provider calls or fallback.
   */
  async projectFields(
    fields: readonly { path: string; text: string }[],
    locale: string,
    scopeId: string,
    binding: {
      entityType: AuthoredLocalizationEntity;
      entityId: string;
      canonicalRevision: string;
      canonicalDigest?: string;
      translationRevision?: number;
    },
  ): Promise<Map<string, string>> {
    if (locale !== "en" && locale !== "vi")
      throw new Error("Unsupported localization locale");
    const requested = fields.filter((field) => field.text.trim());
    if (!requested.length)
      return new Map(fields.map((field) => [field.path, field.text]));
    const target =
      locale === "en"
        ? AuthoredLocalizationLocale.EN
        : AuthoredLocalizationLocale.VI;
    const { translationRevision: boundTranslationRevision, ...whereBinding } =
      binding;
    const rows = await this.prisma.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        locale: target,
        ...whereBinding,
        ...(boundTranslationRevision
          ? { translationRevision: boundTranslationRevision }
          : {}),
        fieldPath: { in: [...new Set(requested.map((field) => field.path))] },
        originSha256: {
          in: [...new Set(requested.map((field) => digest(field.text)))],
        },
      },
      include: { revision: true },
    });
    const result = new Map<string, string>();
    const canonicalDigests = new Set<string>();
    for (const field of requested) {
      const expectedOriginHash = digest(field.text);
      const candidates = rows.filter(
        (row) =>
          row.fieldPath === field.path &&
          row.originSha256 === expectedOriginHash &&
          (row.scopeId === undefined || row.scopeId === scopeId) &&
          (row.locale === undefined || row.locale === target) &&
          (row.entityType === undefined ||
            row.entityType === binding.entityType) &&
          (row.entityId === undefined || row.entityId === binding.entityId) &&
          (row.canonicalRevision === undefined ||
            row.canonicalRevision === binding.canonicalRevision) &&
          (!binding.canonicalDigest ||
            row.canonicalDigest === undefined ||
            row.canonicalDigest === binding.canonicalDigest) &&
          (!boundTranslationRevision ||
            row.translationRevision === boundTranslationRevision),
      );
      const latestRevision = Math.max(
        0,
        ...candidates.map((row) => row.translationRevision),
      );
      const matches = candidates.filter(
        (row) => row.translationRevision === latestRevision,
      );
      const ready = matches.filter(
        (row) =>
          hasReviewedLocale(row) &&
          digest(row.originalContent) === row.originSha256 &&
          row.originSha256 === expectedOriginHash,
      );
      const variants = new Set(ready.map((row) => row.revision!.contentSha256));
      if (
        variants.size > 1 ||
        matches.some(
          (row) =>
            hasReviewedLocale(row) &&
            (digest(row.originalContent) !== row.originSha256 ||
              digest(row.revision!.content) !== row.revision!.contentSha256),
        )
      ) {
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
          randomUUID(),
          {
            status: HttpStatus.CONFLICT,
            meta: {
              locale,
              fieldPath: field.path,
              state: AUTHORED_LOCALIZATION_STATES.FAILED,
            },
          },
        );
      }
      if (!ready.length) {
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
          randomUUID(),
          {
            status: HttpStatus.CONFLICT,
            meta: {
              locale,
              fieldPath: field.path,
              state: matches.some(
                (row) => row.state === AuthoredLocalizationState.FAILED,
              )
                ? AUTHORED_LOCALIZATION_STATES.FAILED
                : AUTHORED_LOCALIZATION_STATES.PENDING,
            },
          },
        );
      }
      const chosen = ready[0];
      if (chosen.canonicalDigest) canonicalDigests.add(chosen.canonicalDigest);
      result.set(field.path, chosen.revision!.content);
    }
    if (canonicalDigests.size > 1) {
      throw problemException(
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
        randomUUID(),
        {
          status: HttpStatus.CONFLICT,
          meta: { locale, state: AUTHORED_LOCALIZATION_STATES.FAILED },
        },
      );
    }
    for (const field of fields)
      if (!field.text.trim()) result.set(field.path, field.text);
    return result;
  }

  /**
   * Business purpose: Apply version-bound narrative translations to a copy of canonical content.
   *
   * Business rules:
   * - Only extracted authored field paths may change; identifiers, quotations and source hashes remain original.
   * Execution flow:
   * 1. Extract eligible fields, resolve their durable path-addressed revisions and overlay the cloned document.
   * Failure cases:
   * - Unavailable revisions or invalid field traversal reject the projection.
   * Side effects:
   * - Return a localized copy without updating canonical records.
   */
  async projectDocument<T>(
    document: T,
    locale: string,
    scopeId: string,
    binding: {
      entityType: AuthoredLocalizationEntity;
      entityId: string;
      canonicalRevision: string;
      canonicalDigest?: string;
      translationRevision?: number;
    },
  ): Promise<T> {
    const fields = authoredFields(document);
    const values = await this.projectFields(fields, locale, scopeId, binding);
    const output = structuredClone(document);
    for (const field of fields) {
      const keys = field.path
        .slice(1)
        .split("/")
        .map((key) => key.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      let target: unknown = output;
      for (const key of keys.slice(0, -1))
        target = (target as Record<string, unknown>)[key];
      (target as Record<string, unknown>)[keys.at(-1)!] = values.get(
        field.path,
      )!;
    }
    return output;
  }

  /**
   * Business purpose: Prepare a localized report view from its verified immutable overlay.
   *
   * Business rules:
   * - Overlay paths must belong to eligible authored fields of the bound canonical report.
   * Execution flow:
   * 1. Load the locale artifact, validate its overlay contract and apply allowed fields to a clone.
   * Failure cases:
   * - Corrupt artifacts or unexpected paths fail without replacing the original report.
   * Side effects:
   * - May freeze a localized artifact; never updates original report bytes.
   */
  async localizedReportDocument(
    scopeId: string,
    sourceArtifactId: string,
    sourceSha256: string,
    report: unknown,
    locale: string,
  ) {
    const artifact = await this.localizedReport(
      scopeId,
      sourceArtifactId,
      sourceSha256,
      report,
      locale,
    );
    if (
      artifact.scopeId !== scopeId ||
      artifact.sourceArtifactId !== sourceArtifactId ||
      artifact.sourceSha256 !== sourceSha256 ||
      digest(Buffer.from(artifact.content).toString("utf8")) !==
        artifact.contentSha256
    )
      throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
    const overlay = localizedReportArtifactSchema.parse(
      JSON.parse(Buffer.from(artifact.content).toString("utf8")),
    );
    const allowed = new Set(authoredFields(report).map((field) => field.path));
    if (
      overlay.localizedArtifactId !== artifact.id ||
      overlay.sourceArtifactId !== sourceArtifactId ||
      overlay.sourceSha256 !== sourceSha256 ||
      overlay.locale !== locale ||
      overlay.translationRevision !== artifact.translationRevision ||
      Object.keys(overlay.localizedFields).length !== allowed.size
    )
      throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
    const document = structuredClone(report);
    for (const [path, content] of Object.entries(overlay.localizedFields)) {
      if (!allowed.has(path))
        throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
      const keys = path
        .slice(1)
        .split("/")
        .map((key) => key.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      let target: unknown = document;
      for (const key of keys.slice(0, -1))
        target = (target as Record<string, unknown>)[key];
      (target as Record<string, unknown>)[keys.at(-1)!] = content;
    }
    return document;
  }

  /**
   * Business purpose: Freeze a stable locale artifact bound to canonical report identity.
   *
   * Business rules:
   * - Existing artifact source/content hashes must match; every translated field must be READY at the bound source revision.
   * Execution flow:
   * 1. Reuse verified bytes or resolve all authored translations and insert the immutable versioned overlay.
   * Failure cases:
   * - Source mismatch, corrupt bytes or incomplete localization prevents artifact availability.
   * Side effects:
   * - Persist new locale artifact bytes with independent identity and digest; preserve canonical storage.
   */
  async localizedReport(
    scopeId: string,
    sourceArtifactId: string,
    sourceSha256: string,
    report: unknown,
    locale: string,
  ) {
    if (locale !== "en" && locale !== "vi")
      throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
    const target =
      locale === "en"
        ? AuthoredLocalizationLocale.EN
        : AuthoredLocalizationLocale.VI;
    const reportFields = authoredFields(report);
    const revisions = await this.prisma.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        locale: target,
        entityId: sourceArtifactId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
        canonicalRevision: sourceSha256,
        canonicalDigest: digest(canonicalJson(report)),
        fieldPath: { in: reportFields.map((field) => field.path) },
        originSha256: { in: reportFields.map((field) => digest(field.text)) },
      },
      select: { translationRevision: true },
    });
    const translationRevision = Math.max(
      1,
      ...revisions.map((row) => row.translationRevision),
    );
    const key = {
      scopeId,
      sourceArtifactId,
      locale: target,
      translationRevision,
    };
    const existing = await this.prisma.localizedReportArtifact.findUnique({
      where: { scopeId_sourceArtifactId_locale_translationRevision: key },
    });
    if (existing) {
      await this.projectFields(reportFields, locale, scopeId, {
        entityId: sourceArtifactId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
        canonicalRevision: sourceSha256,
        canonicalDigest: digest(canonicalJson(report)),
      });
      if (
        existing.scopeId !== scopeId ||
        existing.sourceArtifactId !== sourceArtifactId ||
        existing.locale !== target ||
        existing.translationRevision !== translationRevision ||
        existing.sourceSha256 !== sourceSha256 ||
        digest(Buffer.from(existing.content).toString("utf8")) !==
          existing.contentSha256
      )
        throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
      return existing;
    }
    const values = await this.projectFields(reportFields, locale, scopeId, {
      entityId: sourceArtifactId,
      entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
      canonicalRevision: sourceSha256,
      canonicalDigest: digest(canonicalJson(report)),
    });
    const id = randomUUID();
    const overlay = localizedReportArtifactSchema.parse({
      schemaVersion: LOCALIZED_REPORT_SCHEMA_VERSION,
      localizedArtifactId: id,
      sourceArtifactId,
      sourceSha256,
      locale,
      translationRevision,
      localizedFields: Object.fromEntries(
        reportFields.map((field) => [field.path, values.get(field.path)!]),
      ),
    });
    const content = Buffer.from(JSON.stringify(overlay), "utf8");
    return this.prisma.localizedReportArtifact.upsert({
      where: { scopeId_sourceArtifactId_locale_translationRevision: key },
      update: {},
      create: {
        id,
        ...key,
        sourceSha256,
        content,
        contentSha256: digest(content.toString("utf8")),
      },
    });
  }

  /**
   * Business purpose: Enqueue a bounded restart-safe historical localization batch.
   *
   * Business rules:
   * - Batch size is bounded; idempotent keys preserve existing work; reports require verified source bytes through their separate backfill path.
   * Execution flow:
   * 1. Page the selected canonical entity type, enqueue each row transactionally and return the resume cursor.
   * Failure cases:
   * - Invalid bounds, unsupported entity types or database errors prevent a falsely complete cursor.
   * Side effects:
   * - Insert missing translation jobs while retaining all historical canonical records.
   */
  async backfillBatch(
    scopeId: string,
    entityType: AuthoredLocalizationEntity,
    after: string | null,
    limit = 10,
  ) {
    if (!scopeId || !Number.isInteger(limit) || limit < 1 || limit > 25)
      throw new Error("Invalid backfill bounds");
    const page = {
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    };
    const records: Array<{
      cursor: string;
      entityId: string;
      canonicalRevision: string;
      document: unknown;
    }> = [];
    if (entityType === AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT) {
      for (const row of await this.prisma.legalRequirement.findMany({
        ...page,
        where: { ruleSetVersionId: scopeId },
        orderBy: { id: "asc" },
      }))
        records.push({
          cursor: row.id,
          entityId: row.legalRequirementId,
          canonicalRevision: row.contentDigest,
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE) {
      for (const row of await this.prisma.assessmentRule.findMany({
        ...page,
        where: { ruleSetVersionId: scopeId },
        orderBy: { id: "asc" },
      }))
        records.push({
          cursor: row.id,
          entityId: row.assessmentRuleId,
          canonicalRevision: row.contentDigest,
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.DECISION) {
      for (const row of await this.prisma.assessmentRuleDecision.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { decisionId: { gt: after } } : {}),
        },
        orderBy: { decisionId: "asc" },
      }))
        records.push({
          cursor: row.decisionId,
          entityId: row.decisionId,
          canonicalRevision: String(row.decisionRevision),
          document: row.decision,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.HUMAN_REQUEST) {
      for (const row of await this.prisma.assessmentHumanRequest.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { requestId: { gt: after } } : {}),
        },
        orderBy: { requestId: "asc" },
      }))
        records.push({
          cursor: row.requestId,
          entityId: row.requestId,
          canonicalRevision: String(row.requestRevision),
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.EVENT) {
      for (const row of await this.prisma.assessmentEvent.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { eventId: { gt: after } } : {}),
        },
        orderBy: { eventId: "asc" },
      }))
        records.push({
          cursor: row.eventId,
          entityId: row.eventId,
          canonicalRevision: String(row.sequence),
          document: row.payload,
        });
    } else {
      throw new Error(
        "Report backfill requires verified canonical artifact bytes",
      );
    }
    for (const row of records)
      await this.prisma.$transaction((tx) =>
        enqueueAuthoredDocument(tx, {
          scopeId,
          entityType,
          sourceLanguages: {},
          ...row,
        }),
      );
    return {
      processed: records.length,
      nextCursor: records.at(-1)?.cursor ?? after,
      complete: records.length < limit,
    };
  }
}
