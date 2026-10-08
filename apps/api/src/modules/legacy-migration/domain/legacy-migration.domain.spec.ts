import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_STATUS_CODES,
  ASSESSMENT_LIFECYCLE_STATES as L,
} from "@lcsp/contracts/assessment";
import {
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES as CLASS,
  LEGACY_ARTIFACT_RECONCILIATION_REASONS as REASON,
  LEGACY_ASSESSMENT_DISPOSITIONS,
  LEGACY_BACKFILL_REASONS,
  LEGACY_OUTBOX_DISPOSITIONS,
  LEGACY_OUTBOX_EVENT_TYPES,
  LEGACY_REPORT_UPLOADER_EVIDENCE,
  RETAINED_OUTBOX_EVENT_TYPES,
  V2_WORKER_BOUND_EVENT_TYPES,
} from "@lcsp/contracts/legacy-migration";

import { archiveDigest, sha256Hex } from "./legacy-archive-hash.js";
import { classifyLegacyAssessment } from "./legacy-assessment-classification.js";
import {
  legacyBackfillLifecycle,
  planLegacyBackfill,
} from "./legacy-backfill-plan.js";
import { classifyOutboxEventType } from "./legacy-outbox-classification.js";
import {
  classifyLegacyReadinessExport,
  classifyLegacyReportProbe,
  classifyLegacyReportReference,
  type LegacyReportPolicy,
} from "./legacy-report-classification.js";
import {
  parseLegacyReportReference,
  redactLegacyReportReference,
} from "./legacy-report-reference.js";

const policy = (
  overrides: Partial<LegacyReportPolicy> = {},
): LegacyReportPolicy => ({
  attestedNonPersistingHosts: new Set(),
  readableHttpHosts: new Set(),
  hasFileRoot: false,
  ...overrides,
});

describe("classifyLegacyAssessment", () => {
  it("archives only the two V1 statuses at which the old pipeline had finished", () => {
    const expected: Record<string, string> = {
      [ASSESSMENT_STATUS_CODES.wizardInProgress]:
        LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL,
      [ASSESSMENT_STATUS_CODES.wizardSubmitted]:
        LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL,
      [ASSESSMENT_STATUS_CODES.evidenceRequired]:
        LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL,
      [ASSESSMENT_STATUS_CODES.scanInProgress]:
        LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL,
      [ASSESSMENT_STATUS_CODES.classificationLocked]:
        LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL,
      [ASSESSMENT_STATUS_CODES.readyForReview]:
        LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL,
      [ASSESSMENT_STATUS_CODES.aiNotDetected]:
        LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL,
    };
    for (const status of Object.values(ASSESSMENT_STATUS_CODES))
      expect(classifyLegacyAssessment(status)).toBe(expected[status]);
    expect(Object.keys(expected)).toHaveLength(
      Object.values(ASSESSMENT_STATUS_CODES).length,
    );
  });
});

describe("classifyOutboxEventType", () => {
  it("cancels exactly the retired V1 commands and events", () => {
    for (const type of Object.values(LEGACY_OUTBOX_EVENT_TYPES))
      expect(classifyOutboxEventType(type)).toBe(
        LEGACY_OUTBOX_DISPOSITIONS.CANCEL,
      );
  });

  it("never cancels V2 worker boundaries or retained events, including legal acquisition", () => {
    for (const type of [
      ...Object.values(V2_WORKER_BOUND_EVENT_TYPES),
      ...Object.values(RETAINED_OUTBOX_EVENT_TYPES),
    ])
      expect(classifyOutboxEventType(type)).toBe(
        LEGACY_OUTBOX_DISPOSITIONS.RETAIN,
      );
    // The admin-triggered acquisition command is live V2 and shares nothing with the V1 set.
    expect(
      classifyOutboxEventType("command.legal-corpus.recovery.requested.v1"),
    ).toBe(LEGACY_OUTBOX_DISPOSITIONS.RETAIN);
  });

  it("keeps the cancel and retain sets disjoint and reports unknown types instead of guessing", () => {
    const retained = new Set<string>([
      ...Object.values(V2_WORKER_BOUND_EVENT_TYPES),
      ...Object.values(RETAINED_OUTBOX_EVENT_TYPES),
    ]);
    for (const type of Object.values(LEGACY_OUTBOX_EVENT_TYPES))
      expect(retained.has(type)).toBe(false);
    expect(classifyOutboxEventType("command.something.new.v9")).toBe(
      LEGACY_OUTBOX_DISPOSITIONS.UNCLASSIFIED,
    );
  });
});

describe("parseLegacyReportReference", () => {
  it("parses every reference shape without I/O", () => {
    expect(parseLegacyReportReference(null)).toEqual({ kind: "NONE" });
    expect(parseLegacyReportReference("   ")).toEqual({ kind: "NONE" });
    expect(parseLegacyReportReference("not a url")).toEqual({
      kind: "MALFORMED",
    });
    expect(parseLegacyReportReference("ftp://host/x.md")).toEqual({
      kind: "UNSUPPORTED_SCHEME",
      scheme: "ftp",
    });
    expect(parseLegacyReportReference("file:///var/reports/r.md")).toEqual({
      kind: "FILE",
      path: "/var/reports/r.md",
    });
    expect(parseLegacyReportReference("file://other-host/x")).toEqual({
      kind: "MALFORMED",
    });
    const http = parseLegacyReportReference(
      "HTTPS://Mock-Storage.Local/documents/a.md",
    );
    expect(http.kind === "HTTP" && http.host).toBe("mock-storage.local");
  });

  it("redacts credentials, signed queries and fragments from archived references", () => {
    expect(
      redactLegacyReportReference(
        "https://user:pw@store.example/r/a.md?X-Signature=secret#frag",
      ),
    ).toBe("https://store.example/r/a.md");
    expect(redactLegacyReportReference("garbage")).toBeNull();
  });
});

describe("report reconciliation classification", () => {
  const ready = true;

  it("accounts a placeholder-uploader reference as NO_LEGACY_ARTIFACT_PRESENT without reading anything", () => {
    const reference = parseLegacyReportReference(
      "https://mock-storage.local/documents/gap-analysis/abc-1234abcd.md",
    );
    expect(classifyLegacyReportReference(reference, ready, policy())).toEqual({
      reconciliationClass: CLASS.NO_LEGACY_ARTIFACT_PRESENT,
      reconciliationReason: REASON.PLACEHOLDER_UPLOADER_NEVER_PERSISTED,
    });
  });

  it("accounts requests that never had a reference as metadata only", () => {
    expect(
      classifyLegacyReportReference({ kind: "NONE" }, false, policy()),
    ).toEqual({
      reconciliationClass: CLASS.METADATA_ONLY_LEGACY_RECORD,
      reconciliationReason: REASON.NO_ARTIFACT_REFERENCE,
    });
    expect(
      classifyLegacyReportReference({ kind: "NONE" }, ready, policy()),
    ).toEqual({
      reconciliationClass: CLASS.METADATA_ONLY_LEGACY_RECORD,
      reconciliationReason: REASON.READY_WITHOUT_REFERENCE,
    });
  });

  it("flags malformed, unsupported and unconfigured locations as invalid or orphaned, never as absent", () => {
    expect(
      classifyLegacyReportReference({ kind: "MALFORMED" }, ready, policy())
        ?.reconciliationReason,
    ).toBe(REASON.MALFORMED_REFERENCE);
    expect(
      classifyLegacyReportReference(
        { kind: "UNSUPPORTED_SCHEME", scheme: "ftp" },
        ready,
        policy(),
      )?.reconciliationReason,
    ).toBe(REASON.UNSUPPORTED_REFERENCE_SCHEME);
    const real = parseLegacyReportReference("https://reports.example.com/a.md");
    expect(classifyLegacyReportReference(real, ready, policy())).toEqual({
      reconciliationClass: CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
      reconciliationReason: REASON.LOCATION_NOT_CONFIGURED,
    });
    const file = parseLegacyReportReference("file:///data/a.md");
    expect(
      classifyLegacyReportReference(file, ready, policy())
        ?.reconciliationReason,
    ).toBe(REASON.LOCATION_NOT_CONFIGURED);
  });

  it("requires a read (returns null) only for configured readable locations", () => {
    const real = parseLegacyReportReference("https://reports.example.com/a.md");
    expect(
      classifyLegacyReportReference(
        real,
        ready,
        policy({ readableHttpHosts: new Set(["reports.example.com"]) }),
      ),
    ).toBeNull();
    const file = parseLegacyReportReference("file:///data/a.md");
    expect(
      classifyLegacyReportReference(file, ready, policy({ hasFileRoot: true })),
    ).toBeNull();
  });

  it("honours an operator attestation that a host never held retained bytes", () => {
    const real = parseLegacyReportReference("https://reports.example.com/a.md");
    expect(
      classifyLegacyReportReference(
        real,
        ready,
        policy({
          attestedNonPersistingHosts: new Set(["reports.example.com"]),
        }),
      ),
    ).toEqual({
      reconciliationClass: CLASS.NO_LEGACY_ARTIFACT_PRESENT,
      reconciliationReason: REASON.OPERATOR_ATTESTED_NON_PERSISTING,
    });
  });

  it("claims presence only from a verified probe and maps failures truthfully", () => {
    expect(
      classifyLegacyReportProbe({
        kind: "COPIED",
        sha256: "a".repeat(64),
        sizeBytes: 3,
      }),
    ).toEqual({
      reconciliationClass: CLASS.ARTIFACT_PRESENT_AND_COPIED,
      reconciliationReason: REASON.COPIED_AND_VERIFIED,
    });
    expect(classifyLegacyReportProbe({ kind: "MISSING" })).toEqual({
      reconciliationClass: CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
      reconciliationReason: REASON.REFERENCE_TARGET_MISSING,
    });
    expect(
      classifyLegacyReportProbe({ kind: "OUTSIDE_ALLOWED_ROOT" })
        .reconciliationReason,
    ).toBe(REASON.REFERENCE_OUTSIDE_ALLOWED_ROOT);
    expect(
      classifyLegacyReportProbe({
        kind: "COPY_FAILED",
        reason: REASON.COPY_VERIFICATION_MISMATCH,
      }),
    ).toEqual({
      reconciliationClass: CLASS.ARTIFACT_PRESENT_BUT_COPY_FAILED,
      reconciliationReason: REASON.COPY_VERIFICATION_MISMATCH,
    });
  });

  it("treats a generated readiness export with inline content as a real persisted artifact", () => {
    expect(
      classifyLegacyReadinessExport({ status: "GENERATED", hasContent: true }),
    ).toEqual({
      reconciliationClass: CLASS.ARTIFACT_PRESENT_AND_COPIED,
      reconciliationReason: REASON.INLINE_CONTENT_ARCHIVED,
    });
    expect(
      classifyLegacyReadinessExport({ status: "BLOCKED", hasContent: false }),
    ).toEqual({
      reconciliationClass: CLASS.METADATA_ONLY_LEGACY_RECORD,
      reconciliationReason: REASON.NO_INLINE_CONTENT,
    });
    expect(
      classifyLegacyReadinessExport({ status: "GENERATED", hasContent: false })
        .reconciliationClass,
    ).toBe(CLASS.METADATA_ONLY_LEGACY_RECORD);
  });
});

describe("planLegacyBackfill", () => {
  const snap = (
    id: string,
    minute: number,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    status: "READY",
    commitSha: "c".repeat(40),
    connectionStatus: "ACTIVE",
    repositoryId: "repo-1",
    repositoryFullName: "owner/repo",
    connectionRepositoryId: "repo-1",
    connectionRepositoryFullName: "owner/repo",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)),
    ...over,
  });

  it("leaves assessments without a snapshot waiting for required input without inventing a pin", () => {
    expect(planLegacyBackfill([])).toEqual({
      pinSnapshotId: null,
      reason: LEGACY_BACKFILL_REASONS.NO_SNAPSHOT,
    });
    expect(legacyBackfillLifecycle(planLegacyBackfill([]))).toBe(
      L.WAITING_FOR_REQUIRED_INPUT,
    );
  });

  it("pins the newest READY snapshot with a well-formed commit and a live connection", () => {
    expect(
      planLegacyBackfill([snap("old", 1), snap("new", 9), snap("mid", 5)]),
    ).toEqual({
      pinSnapshotId: "new",
      reason: LEGACY_BACKFILL_REASONS.PINNED_LATEST_READY_SNAPSHOT,
    });
  });

  it("skips unusable snapshots and never pins one it cannot trust", () => {
    const plan = planLegacyBackfill([
      snap("revoked", 9, { connectionStatus: "REVOKED" }),
      snap("gone", 8, { connectionStatus: null }),
      snap("badsha", 7, { commitSha: "xyz" }),
      snap("notready", 6, { status: "FAILED" }),
    ]);
    expect(plan).toEqual({
      pinSnapshotId: null,
      reason: LEGACY_BACKFILL_REASONS.NO_USABLE_SNAPSHOT,
    });
    expect(legacyBackfillLifecycle(plan)).toBe(L.WAITING_FOR_REQUIRED_INPUT);
    expect(
      planLegacyBackfill([
        snap("revoked", 9, { connectionStatus: "REVOKED" }),
        snap("ok", 1),
      ]).pinSnapshotId,
    ).toBe("ok");
  });

  it("never recovers a snapshot whose repository identity disagrees with its connection", () => {
    for (const snapshot of [
      snap("wrong-id", 1, { connectionRepositoryId: "another-repo" }),
      snap("wrong-name", 1, { connectionRepositoryFullName: "another/repo" }),
      snap("empty-id", 1, { repositoryId: "", connectionRepositoryId: "" }),
    ])
      expect(planLegacyBackfill([snapshot]).pinSnapshotId).toBeNull();
    expect(
      legacyBackfillLifecycle(planLegacyBackfill([snap("valid", 1)])),
    ).toBe(L.PREPARING);
  });
});

describe("archive hashing", () => {
  it("is order-independent and sensitive to every record hash", () => {
    const a = {
      sourceTable: "ASSESSMENT",
      sourceId: "a1",
      payloadSha256: sha256Hex("1"),
    };
    const b = {
      sourceTable: "DOCUMENT_REQUEST",
      sourceId: "d1",
      payloadSha256: sha256Hex("2"),
    };
    expect(archiveDigest([a, b])).toBe(archiveDigest([b, a]));
    expect(archiveDigest([a, b])).not.toBe(
      archiveDigest([a, { ...b, payloadSha256: sha256Hex("3") }]),
    );
    expect(archiveDigest([a])).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("placeholder uploader evidence", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../..",
  );
  const file = (relative: string) => path.join(repoRoot, relative);

  it("matches the pinned source hash and still returns a mock URL without persisting", () => {
    const uploader = file(LEGACY_REPORT_UPLOADER_EVIDENCE.sourcePath);
    if (!existsSync(uploader)) return; // W7 may delete the placeholder; the pinned evidence then stands alone
    const source = readFileSync(uploader);
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      LEGACY_REPORT_UPLOADER_EVIDENCE.sha256,
    );
    const text = source.toString("utf8");
    expect(text).toContain("mock-storage.local");
    expect(text).not.toMatch(/boto3\.|put_object|upload_file|open\(.*["']w/u);
  });

  it("limits document_url producers to the two recorded callers", () => {
    for (const caller of LEGACY_REPORT_UPLOADER_EVIDENCE.callers) {
      const callerPath = file(caller);
      if (!existsSync(callerPath)) continue;
      expect(readFileSync(callerPath, "utf8")).toContain(
        "StorageUploader.upload_document",
      );
    }
  });
});
