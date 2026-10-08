import { createHash } from "node:crypto";

import {
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
  LEGACY_ARTIFACT_RECONCILIATION_REASONS,
  LEGACY_MIGRATION_ERROR_CODES,
  LEGACY_MIGRATION_PHASES,
  LEGACY_OUTBOX_DISPOSITIONS,
  LEGACY_REPORT_LIMITATION,
  LEGACY_REPORT_UPLOADER_EVIDENCE,
  legacyMigrationValidationReportSchema,
  type LegacyArchiveSource,
  type LegacyMigrationValidationReport,
  type LegacyValidationCheck,
} from "@lcsp/contracts/legacy-migration";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import {
  classifyOutboxEventType,
  LEGACY_OUTBOX_EVENT_TYPE_LIST,
} from "../../../domain/legacy-outbox-classification.js";
import {
  CLOSED_AT_QUIESCENCE_SOURCES,
  IN_FLIGHT_CLOSURE_RULES,
  REPORT_ARCHIVE_SOURCES,
  SQL_ARCHIVE_SOURCES,
  type InFlightClosureRule,
  type SqlArchiveSource,
} from "../../../infrastructure/persistence/legacy-archive-registry.js";
import { LegacyArchiveRepository } from "../../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyValidationRepository } from "../../../infrastructure/persistence/legacy-validation.repository.js";
import { LegacyArchiveBlobStore } from "../../../../legacy-archive/infrastructure/storage/legacy-archive-blob.store.js";
import { LegacyMigrationError } from "../../legacy-migration.error.js";
import {
  check,
  jsonEqual,
  summarize,
  withoutKeys,
  zero,
} from "./legacy-validation-checks.js";
import { ValidateLegacyMigrationQuery } from "./validate-legacy-migration.query.js";

type Run = NonNullable<Awaited<ReturnType<LegacyArchiveRepository["findRun"]>>>;

const ALL_SOURCES: readonly SqlArchiveSource[] = [
  ...SQL_ARCHIVE_SOURCES,
  ...REPORT_ARCHIVE_SOURCES,
];

const closureFor = (
  source: LegacyArchiveSource,
): InFlightClosureRule | undefined =>
  IN_FLIGHT_CLOSURE_RULES.find((rule) => rule.source === source);

/** Columns a sampled comparison ignores because V2 or quiescence legitimately rewrote them. */
function volatileKeys(rule: SqlArchiveSource): string[] {
  const closure = closureFor(rule.source);
  const closed = closure
    ? [
        closure.payloadKey,
        ...(closure.markerColumn
          ? [closure.markerColumn.replaceAll('"', "")]
          : []),
        "updatedAt",
      ]
    : [];
  return [...(rule.stableExclude ?? []), ...closed];
}

@QueryHandler(ValidateLegacyMigrationQuery)
export class ValidateLegacyMigrationHandler implements IQueryHandler<ValidateLegacyMigrationQuery> {
  constructor(
    private readonly archive: LegacyArchiveRepository,
    private readonly validation: LegacyValidationRepository,
    private readonly blobs: LegacyArchiveBlobStore,
  ) {}

  async execute(
    query: ValidateLegacyMigrationQuery,
  ): Promise<LegacyMigrationValidationReport> {
    const run = await this.archive.findRun(query.runId);
    if (!run)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.RUN_NOT_FOUND,
        query.runId,
      );

    const checks: LegacyValidationCheck[] = [
      ...(await this.portfolio()),
      ...(await this.coverage()),
      ...(await this.integrity()),
      ...(await this.closure()),
      ...(await this.outbox()),
      ...(await this.summaries()),
      ...(await this.backfill()),
      ...(await this.noAiEffects()),
      ...(await this.sampled(query)),
      ...(await this.v2Isolation(run)),
      ...(await this.rollbackBoundary()),
    ];
    const reports = await this.reports();
    checks.push(...reports.checks);

    const executed = new Set(Object.keys((run.phaseResults ?? {}) as object));
    const report = {
      runId: run.id,
      kind: run.kind,
      generatedAt: new Date().toISOString(),
      phases: Object.values(LEGACY_MIGRATION_PHASES).filter((phase) =>
        executed.has(phase),
      ),
      checks,
      summary: summarize(checks),
      artifactReconciliation: reports.reconciliation,
    };
    // The report is itself a contract: a malformed one must fail loudly, never be published.
    const parsed = legacyMigrationValidationReportSchema.parse(report);
    await this.archive.recordPhase(run.id, LEGACY_MIGRATION_PHASES.VALIDATE, {
      generatedAt: parsed.generatedAt,
      summary: parsed.summary,
    });
    return parsed;
  }

  // ---- inputs -------------------------------------------------------------------------------

  private async portfolio(): Promise<LegacyValidationCheck[]> {
    const portfolio = await this.validation.activePortfolio();
    return [
      check({
        id: "ACTIVE_LEGAL_PORTFOLIO",
        title:
          "Exactly one ACTIVE legal portfolio with engineering rules is pinned from",
        observed: portfolio,
        expected: { activeCount: 1, engineeringRuleCount: ">0" },
        ok: portfolio.activeCount === 1 && portfolio.engineeringRuleCount > 0,
      }),
    ];
  }

  // ---- archive completeness -----------------------------------------------------------------

  private async coverage(): Promise<LegacyValidationCheck[]> {
    const checks: LegacyValidationCheck[] = [];
    for (const rule of ALL_SOURCES) {
      const closure = CLOSED_AT_QUIESCENCE_SOURCES.has(rule.source)
        ? closureFor(rule.source)
        : undefined;
      const facts = await this.validation.archiveCoverage(rule, closure);
      checks.push(
        check({
          id: `ARCHIVE_COVERAGE.${rule.source}`,
          title: `Every live ${rule.source} row is archived with an identical hash`,
          observed: facts,
          expected: { missing: 0, mismatched: 0 },
          ok: facts.missing === 0 && facts.mismatched === 0,
        }),
      );
    }
    return checks;
  }

  private async integrity(): Promise<LegacyValidationCheck[]> {
    return [
      zero(
        "ARCHIVE_PAYLOAD_HASHES",
        "Every archived payload still hashes to its recorded sha256",
        await this.validation.payloadIntegrityFailures(),
      ),
      zero(
        "ARCHIVE_RECORD_IDS",
        "Every archive record id equals its deterministic definition",
        await this.validation.archiveRowIdFailures(),
      ),
      zero(
        "ARCHIVE_ASSESSMENT_FK",
        "Archived ASSESSMENT records point at their own assessment",
        await this.validation.tenantFkFailures(),
      ),
    ];
  }

  // ---- zero old execution -------------------------------------------------------------------

  private async closure(): Promise<LegacyValidationCheck[]> {
    const checks: LegacyValidationCheck[] = [];
    for (const rule of IN_FLIGHT_CLOSURE_RULES) {
      const remaining = await this.validation.inFlightCount(rule);
      const outcome = await this.validation.closureOutcome(rule);
      checks.push(
        check({
          id: `CLOSURE.${rule.source}`,
          title: `No ${rule.source} row is still in flight; closed rows are archived first`,
          observed: { inFlightRemaining: remaining, ...outcome },
          expected: { inFlightRemaining: 0, closed_bad: 0 },
          ok: remaining === 0 && Number(outcome.closed_bad) === 0,
        }),
      );
    }
    return checks;
  }

  private async outbox(): Promise<LegacyValidationCheck[]> {
    const undelivered = await this.validation.undeliveredOutbox();
    const byDisposition = (disposition: string) =>
      undelivered
        .filter((row) => classifyOutboxEventType(row.eventType) === disposition)
        .reduce((total, row) => total + Number(row.n), 0);
    const cancelled = await this.validation.cancelledOutboxFacts();
    return [
      zero(
        "OUTBOX_NO_UNDELIVERED_LEGACY_MESSAGE",
        "No retired V1 command or event can still be delivered",
        await this.validation.undeliveredLegacyOutbox(
          LEGACY_OUTBOX_EVENT_TYPE_LIST,
        ),
      ),
      zero(
        "OUTBOX_NO_UNCLASSIFIED_UNDELIVERED_MESSAGE",
        "Every undelivered message type is positively classified (fail closed)",
        byDisposition(LEGACY_OUTBOX_DISPOSITIONS.UNCLASSIFIED),
      ),
      check({
        id: "OUTBOX_CANCELLED_ARCHIVED_AND_AUDITED",
        title:
          "Every cancelled legacy message has an archived original and an audit event",
        observed: cancelled,
        expected: "cancelled = archived = audited",
        ok:
          Number(cancelled.cancelled) === Number(cancelled.archived) &&
          Number(cancelled.cancelled) === Number(cancelled.audited),
      }),
    ];
  }

  // ---- summaries & backfill -----------------------------------------------------------------

  private async summaries(): Promise<LegacyValidationCheck[]> {
    const facts = await this.validation.summaryFacts();
    const summaries = Number(facts.summaries);
    return [
      check({
        id: "ASSESSMENT_SUMMARY_COVERAGE",
        title:
          "Each archived V1 assessment has exactly one summary of the right disposition",
        observed: facts,
        expected:
          "summaries = archived assessments = terminal_ok + non_terminal_ok",
        ok:
          summaries === Number(facts.v1_assessments) &&
          Number(facts.terminal_ok) + Number(facts.non_terminal_ok) ===
            summaries,
      }),
      check({
        id: "ASSESSMENT_SUMMARY_IDENTITY",
        title:
          "Tenant, record count and per-assessment digest match the archive",
        observed: {
          ownerMismatch: Number(facts.owner_mismatch),
          countMismatch: Number(facts.count_mismatch),
          digestMismatch: Number(facts.digest_mismatch),
        },
        expected: { ownerMismatch: 0, countMismatch: 0, digestMismatch: 0 },
        ok:
          Number(facts.owner_mismatch) === 0 &&
          Number(facts.count_mismatch) === 0 &&
          Number(facts.digest_mismatch) === 0,
      }),
      zero(
        "TERMINAL_V1_HAS_NO_V2_STATE",
        "Archived terminal V1 assessments have no canonical lifecycle, runtime or case",
        await this.validation.terminalWithV2State(),
      ),
    ];
  }

  private async backfill(): Promise<LegacyValidationCheck[]> {
    const facts = await this.validation.backfilledFacts();
    const n = (key: keyof typeof facts) => Number(facts[key]);
    return [
      zero(
        "BACKFILL_HAS_LIFECYCLE",
        "Every backfilled assessment has canonical state",
        n("missing_state"),
      ),
      zero(
        "BACKFILL_HAS_RUNTIME",
        "Every backfilled assessment has one runtime",
        n("missing_runtime"),
      ),
      zero(
        "BACKFILL_THREAD_MATCHES_SUMMARY",
        "Runtime thread equals the summary's fresh V2 thread",
        n("thread_mismatch"),
      ),
      zero(
        "BACKFILL_UNIQUE_THREADS",
        "No two runtimes share a thread",
        n("duplicate_threads"),
      ),
      zero(
        "BACKFILL_NO_V1_THREAD_REUSE",
        "No V2 thread reuses a V1 runtime-turn thread id",
        n("v1_thread_reuse"),
      ),
      zero(
        "BACKFILL_HAS_PORTFOLIO_PIN",
        "Every backfilled case pins the ACTIVE legal portfolio",
        n("missing_portfolio_pin"),
      ),
      check({
        id: "BACKFILL_REPOSITORY_INPUT_DISPOSITIONS",
        title:
          "Every migrated case is repository-pinned or explicitly waiting/blocked for repository input",
        observed: {
          total: n("backfilled"),
          pinned: n("repository_pinned"),
          waitingForRequiredInput: n("waiting_for_repository"),
          blockedRepositoryUnavailable: n("blocked_repository"),
          unexplained: n("unexplained_unpinned"),
        },
        expected: "pinned + waiting + blocked = total; unexplained = 0",
        ok:
          n("unexplained_unpinned") === 0 &&
          n("repository_pinned") +
            n("waiting_for_repository") +
            n("blocked_repository") ===
            n("backfilled"),
      }),
      zero(
        "BACKFILL_UNPINNED_EXECUTION",
        "No unpinned case has a Root command, lease or started execution",
        n("unpinned_execution"),
      ),
      zero(
        "BACKFILL_PIN_IS_VALID_SNAPSHOT",
        "A pinned snapshot belongs to the assessment and matches its commit",
        n("bad_pin"),
      ),
      zero(
        "BACKFILL_COVERAGE_COMPLETE",
        "A pinned case has one coverage row per engineering rule",
        n("coverage_gap"),
      ),
      zero(
        "BACKFILL_PROMOTES_NO_V1_SEMANTICS",
        "No V1 decision, fact, evidence or question was promoted into an unstarted assessment",
        n("promoted_records"),
      ),
    ];
  }

  // ---- the migration starts nothing and spends nothing -------------------------------------------

  private async noAiEffects(): Promise<LegacyValidationCheck[]> {
    const facts = await this.validation.migrationAiEffectFacts();
    return [
      zero(
        "MIGRATION_ENQUEUED_NO_ROOT_COMMAND",
        "No migration run enqueued an Assessment Root command: re-evaluation is never a migration side effect",
        Number(facts.migration_root_commands),
      ),
      check({
        id: "UNSTARTED_ASSESSMENTS_HAVE_NO_AI_EFFECT",
        title:
          "Migrated assessments nobody started have no Root command, lease, Root event, usage or reservation",
        observed: {
          unstarted: Number(facts.unstarted),
          withEffect: Number(facts.unstarted_with_effect),
        },
        expected: { withEffect: 0 },
        ok: Number(facts.unstarted_with_effect) === 0,
      }),
      zero(
        "REEVALUATION_LEDGER_MATCHES_ROOT_COMMANDS",
        "Every operator re-evaluation has exactly one Root command, and every re-evaluation Root command has a ledger row",
        Number(facts.ledger_mismatch),
      ),
    ];
  }

  // ---- independent sampled reconciliation -----------------------------------------------------

  private async sampled(
    query: ValidateLegacyMigrationQuery,
  ): Promise<LegacyValidationCheck[]> {
    const checks: LegacyValidationCheck[] = [];
    for (const rule of ALL_SOURCES) {
      const ids = await this.validation.sampleArchivedIds(
        rule.source,
        query.runId,
        query.sampleSize,
      );
      let hashMismatches = 0;
      let contentMismatches = 0;
      for (const { sourceId } of ids) {
        const archived = await this.validation.archivedRecord(
          rule.source,
          sourceId,
        );
        const live = await this.validation.livePayload(rule, sourceId);
        if (!archived) continue;
        // Re-hash in Node rather than trusting the database's own digest of itself.
        if (
          createHash("sha256").update(archived.text, "utf8").digest("hex") !==
          archived.sha256
        )
          hashMismatches += 1;
        const keys = volatileKeys(rule);
        // A live-writable source (legal corpus acquisition) may have moved on since the snapshot.
        if (
          !rule.liveWritable &&
          (!live ||
            !jsonEqual(
              withoutKeys(JSON.parse(archived.text), keys),
              withoutKeys(live.payload, keys),
            ))
        )
          contentMismatches += 1;
      }
      checks.push(
        check({
          id: `SAMPLED_RECONCILIATION.${rule.source}`,
          title: `Sampled ${rule.source} rows re-hash and match their live source independently`,
          observed: { sampled: ids.length, hashMismatches, contentMismatches },
          expected: { hashMismatches: 0, contentMismatches: 0 },
          ok: hashMismatches === 0 && contentMismatches === 0,
        }),
      );
    }
    return checks;
  }

  // ---- reports -------------------------------------------------------------------------------

  private async reports() {
    const rows = await this.validation.reportClassCounts();
    const blobs = await this.validation.blobFacts();
    const byClass = Object.fromEntries(
      Object.values(LEGACY_ARTIFACT_RECONCILIATION_CLASSES).map((c) => [c, 0]),
    ) as Record<string, number>;
    const byReason = Object.fromEntries(
      Object.values(LEGACY_ARTIFACT_RECONCILIATION_REASONS).map((r) => [r, 0]),
    ) as Record<string, number>;
    for (const row of rows) {
      byClass[row.cls] = (byClass[row.cls] ?? 0) + Number(row.n);
      byReason[row.reason] = (byReason[row.reason] ?? 0) + Number(row.n);
    }
    // Inline exports (ReadinessExport.contentJson) are class COPIED too but live in the archived row,
    // so only the byte-copy reason is expected to have a blob.
    const copied =
      byReason[LEGACY_ARTIFACT_RECONCILIATION_REASONS.COPIED_AND_VERIFIED] ?? 0;
    const unresolved =
      byReason[
        LEGACY_ARTIFACT_RECONCILIATION_REASONS.LOCATION_NOT_CONFIGURED
      ] ?? 0;
    const failed =
      byClass[
        LEGACY_ARTIFACT_RECONCILIATION_CLASSES.ARTIFACT_PRESENT_BUT_COPY_FAILED
      ] ?? 0;
    const orphaned =
      byClass[
        LEGACY_ARTIFACT_RECONCILIATION_CLASSES
          .INVALID_OR_ORPHANED_LEGACY_REFERENCE
      ] ?? 0;
    const checks: LegacyValidationCheck[] = [
      zero(
        "REPORT_LOCATIONS_RESOLVED",
        "No report reference points at a location nobody configured or attested",
        unresolved,
      ),
      zero(
        "REPORT_NO_PRESENT_BUT_UNCOPIED_ARTIFACT",
        "No persisted legacy artifact is left uncopied",
        failed,
      ),
      zero(
        "REPORT_COPIED_AND_BLOBS_AGREE",
        "Every copied artifact has a verified blob and every blob belongs to a copied artifact",
        Number(blobs.copied_without_blob) + Number(blobs.orphan_blobs),
      ),
      check({
        id: "REPORT_COPIED_COUNT_MATCHES_BLOBS",
        title: "Byte-copied artifact records equal stored blobs",
        observed: { copied, blobs: Number(blobs.blobs) },
        expected: "copied = blobs",
        ok: copied === Number(blobs.blobs),
      }),
      await this.blobBytesCheck(),
      check({
        id: "REPORT_INVALID_OR_ORPHANED_REFERENCES",
        title:
          "References that point nowhere are accounted for, never repaired or invented",
        observed: orphaned,
        expected: "accounted (non-blocking)",
        ok: orphaned === 0,
        blocking: false,
      }),
    ];
    return {
      checks,
      reconciliation: {
        total: rows.reduce((total, row) => total + Number(row.n), 0),
        byClass,
        byReason,
        uploaderEvidence: {
          ...LEGACY_REPORT_UPLOADER_EVIDENCE,
          callers: [...LEGACY_REPORT_UPLOADER_EVIDENCE.callers],
        },
        limitation: LEGACY_REPORT_LIMITATION,
      } as LegacyMigrationValidationReport["artifactReconciliation"],
    };
  }

  /** Re-reads every stored blob from disk and re-hashes it against the database record. */
  private async blobBytesCheck(): Promise<LegacyValidationCheck> {
    const blobs = await this.validation.allBlobs();
    let corrupt = 0;
    for (const blob of blobs) {
      try {
        const bytes = await this.blobs.read(blob.storageRef);
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (
          hash !== blob.contentSha256 ||
          bytes.length !== Number(blob.sizeBytes)
        )
          corrupt += 1;
      } catch {
        corrupt += 1;
      }
    }
    return zero(
      "REPORT_BLOB_BYTES_VERIFIED",
      "Every stored blob re-reads from storage with the recorded hash and size",
      corrupt,
    );
  }

  // ---- V2 isolation & rollback boundary -------------------------------------------------------

  private async v2Isolation(run: Run): Promise<LegacyValidationCheck[]> {
    const before = (
      run.phaseResults as Record<
        string,
        { v2ArtifactFingerprint?: { rows: number; digest: string } }
      > | null
    )?.PREFLIGHT?.v2ArtifactFingerprint;
    const now = await this.validation.v2ArtifactFingerprint();
    const { boundaryClosedAt } = await this.archive.restoreState();
    const comparable = before !== undefined && boundaryClosedAt === null;
    const unchanged =
      before !== undefined &&
      before.rows === now.rows &&
      before.digest === now.digest;
    const store = await this.validation.sharedLearningStoreRows();
    return [
      check({
        id: "V2_ARTIFACTS_UNCHANGED_BY_MIGRATION",
        title:
          "The migration never wrote, replaced or reconstructed a V2 AssessmentArtifact",
        observed: { before: before ?? null, now },
        expected: "identical while the rollback boundary is open",
        ok: unchanged,
        // Once V2 traffic has started the fingerprint is expected to move; only warn then.
        blocking: comparable,
      }),
      check({
        id: "SHARED_LEARNING_STORE_NOT_SEEDED",
        title: "No V1 memory was promoted into the shared learning store",
        observed: store,
        expected: "absent or empty at migration time",
        ok: store === null || store === 0,
        blocking: false,
      }),
    ];
  }

  private async rollbackBoundary(): Promise<LegacyValidationCheck[]> {
    const { point, boundaryClosedAt } = await this.archive.restoreState();
    const checks = [
      check({
        id: "RESTORE_POINT_RECORDED",
        title:
          "A pre-first-V2-write restore point is recorded for this cutover",
        observed: point
          ? { ref: point.restorePointRef, digest: point.restorePointDigest }
          : null,
        expected: "ref and digest recorded",
        ok:
          point !== null &&
          point.restorePointRef !== null &&
          point.restorePointDigest !== null,
      }),
      check({
        id: "RESTORE_POINT_RESTORE_VERIFIED",
        title: "The restore point was restored and compared successfully",
        observed: point?.restorePointVerifiedAt?.toISOString() ?? null,
        expected: "verified before the boundary closes",
        ok: point?.restorePointVerifiedAt != null,
      }),
    ];
    if (point?.restorePointRecordedAt && boundaryClosedAt === null) {
      const writes = await this.validation.v2AcceptedWritesSince(
        point.restorePointRecordedAt,
      );
      checks.push(
        check({
          id: "NO_ACCEPTED_V2_WRITES_WHILE_RESTORE_BOUNDARY_OPEN",
          title:
            "No accepted V2 write exists while a restore is still the rollback path",
          observed: writes,
          expected: { total: 0 },
          ok: writes.total === 0,
        }),
      );
    }
    return checks;
  }
}
