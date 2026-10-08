// Production-shaped V1 population for the W6 cutover rehearsal.
//
// Runs on a DISPOSABLE database migrated to the V1 baseline (no W1-W6 tables yet). Every id is
// deterministic. The returned manifest is an INDEPENDENT oracle: expectations are derived here, from
// what was seeded, never from the migration tool's own constants (event-type strings are hard-coded
// on purpose).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const md5 = (value) => createHash("md5").update(value).digest("hex");
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
/** Deterministic RFC-4122-shaped id. */
export const uid = (kind, n) => {
  const h = md5(`${kind}:${n}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const json = (value) => JSON.stringify(value);
const at = (minutes) =>
  new Date(Date.UTC(2026, 7, 1, 8, 0, 0) + minutes * 60_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");

/** Terminal V1 statuses are exactly these two. */
const STATUS_CYCLE = [
  "READY_FOR_REVIEW",
  "READY_FOR_REVIEW",
  "AI_NOT_DETECTED",
  "WIZARD_IN_PROGRESS",
  "WIZARD_SUBMITTED",
  "EVIDENCE_REQUIRED",
  "SCAN_IN_PROGRESS",
  "CLASSIFICATION_LOCKED",
  "READY_FOR_REVIEW",
  "AI_NOT_DETECTED",
];
const TERMINAL = new Set(["READY_FOR_REVIEW", "AI_NOT_DETECTED"]);

/** Retired V1 commands/events (hard-coded oracle; keep in sync with the Freeze, not with the tool). */
export const LEGACY_EVENT_TYPES = [
  "command.scan.requested.v1",
  "command.scan.targeted-reanalysis.v1",
  "command.assessment-interview.pause-agent.v1",
  "command.assessment-interview.resume-agent.v1",
  "command.legal-matching.requested.v1",
  "event.technical-evidence.accepted.v1",
  "event.technical-profile.ready.v1",
  "event.ai-usage-flow.ready.v1",
  "event.classification-result.ready.v1",
  "event.reconciliation.all-conflicts-resolved.v1",
  "document.final-report-requested",
  "document.gap-analysis-requested",
];
const KEPT_EVENT_TYPES = [
  "command.legal-corpus.recovery.requested.v1",
  "command.legal-source.ingest.v1",
  "command.legal-chunks.build.v1",
  "audit.export-requested",
  "event.assessment.created.v1",
  "event.repository-snapshot.created.v1",
  "command.billing.sepay-reconcile.v1",
];

async function insert(client, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const chunk = Math.max(1, Math.floor(30_000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += chunk) {
    const part = rows.slice(offset, offset + chunk);
    const values = [];
    const tuples = part.map(
      (row, r) =>
        `(${columns
          .map((column, k) => {
            values.push(row[column]);
            return `$${r * columns.length + k + 1}`;
          })
          .join(",")})`,
    );
    await client.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

/**
 * @param {import("pg").Client} client connected to the V1-baseline disposable database
 * @param {{assessments?: number, reportsDir: string}} options `reportsDir` receives the synthetic
 *   persisted-report fixtures that `file:` references point at.
 */
export async function seedV1Population(
  client,
  { assessments = 60, reportsDir },
) {
  mkdirSync(reportsDir, { recursive: true });
  const manifest = {
    assessments: {
      total: assessments,
      terminal: 0,
      nonTerminal: 0,
      byStatus: {},
    },
    owners: [],
    ids: {
      terminal: [],
      nonTerminal: [],
      withUsableSnapshot: [],
      withoutUsableSnapshot: [],
    },
    expectedBackfillReasons: {
      PINNED_LATEST_READY_SNAPSHOT: 0,
      NO_SNAPSHOT: 0,
      NO_USABLE_SNAPSHOT: 0,
    },
    inFlight: {
      ASSESSMENT_RUNTIME_TURN: 0,
      TARGETED_REANALYSIS_REQUEST: 0,
      TARGETED_REANALYSIS_CHECKPOINT: 0,
      REPOSITORY_SCAN_JOB: 0,
      DOCUMENT_REQUEST: 0,
    },
    outbox: {
      cancelled: 0,
      publishedLegacy: 0,
      keptUndelivered: 0,
      byLegacyType: {},
    },
    reports: {
      expected: {}, // `${class}/${reason}` -> count (document requests + readiness exports)
      persistedFixtures: [], // [{documentRequestId, path, sha256, sizeBytes}]
    },
    rows: {},
  };
  const tally = (key) =>
    (manifest.reports.expected[key] =
      (manifest.reports.expected[key] ?? 0) + 1);
  const count = (table, n = 1) =>
    (manifest.rows[table] = (manifest.rows[table] ?? 0) + n);

  // ---- identities ------------------------------------------------------------------------------
  const owners = [0, 1, 2].map((i) => ({
    id: uid("user", i),
    email: `w6-owner-${i}@acme.test`,
    passwordHash: "x".repeat(60),
    emailVerified: true,
    failedLoginCount: 0,
    updatedAt: at(0),
  }));
  const admin = {
    id: uid("user", 9),
    email: "w6-admin@acme.test",
    passwordHash: "x".repeat(60),
    emailVerified: true,
    failedLoginCount: 0,
    updatedAt: at(0),
  };
  await insert(client, "User", [...owners, admin]);
  count("User", 4);
  manifest.owners = owners.map((o) => o.id);

  // ---- global legal catalog / corpus (V1 approval + cache semantics) ----------------------------
  const corpusA = uid("corpus", 1);
  const corpusB = uid("corpus", 2);
  await insert(client, "LegalCorpusVersion", [
    {
      id: corpusA,
      version: "w6-corpus-a",
      status: "APPROVED",
      sourceManifest: json({}),
    },
    {
      id: corpusB,
      version: "w6-corpus-b",
      status: "SUPERSEDED",
      sourceManifest: json({}),
    },
  ]);
  const catalog = uid("catalog", 1);
  await insert(client, "LegalRuleCatalogVersion", [
    { id: catalog, version: "w6-catalog-1", ruleRefs: json([]) },
  ]);
  await insert(
    client,
    "LegalRule",
    [1, 2, 3].map((n) => ({
      id: uid("legalrule", n),
      legalRuleId: `LR-${n}`,
      legalRuleCatalogVersionId: catalog,
      ruleFamily: "FAMILY",
      requiredFacts: json([]),
      unknownFactPolicy: "NEEDS_REVIEW",
      citationLocatorRefs: json([]),
      authoredBy: "w6-seed",
    })),
  );
  await insert(client, "RuleApprovalRecord", [
    {
      id: uid("ruleapproval", 1),
      legalRuleCatalogVersionId: catalog,
      approvedBy: admin.id,
      status: "APPROVED",
      scopeDescription: "V1 catalog approval (non-authority after cutover)",
    },
  ]);
  await insert(client, "CorpusApprovalRecord", [
    {
      id: uid("corpusapproval", 1),
      legalCorpusVersionId: corpusA,
      approvedBy: admin.id,
      status: "APPROVED",
      scopeDescription: "V1 corpus approval (non-authority after cutover)",
    },
  ]);
  await insert(client, "CorpusDiscardReceipt", [
    {
      id: uid("discard", 1),
      corpusVersionId: corpusB,
      actorId: admin.id,
      idempotencyKey: "w6-discard-1",
    },
  ]);
  await insert(client, "CorpusPreparation", [
    {
      id: uid("corpusprep", 1),
      idempotencyKey: "w6-prep-1",
      targetCorpusId: corpusA,
      requestedBy: admin.id,
      correlationId: "w6-corr",
    },
  ]);
  count("LegalCorpusVersion", 2);
  count("LegalRuleCatalogVersion");
  count("LegalRule", 3);
  count("RuleApprovalRecord");
  count("CorpusApprovalRecord");
  count("CorpusDiscardReceipt");
  count("CorpusPreparation");

  // ---- assessments and their V1 pipeline -------------------------------------------------------
  const batches = {};
  const add = (table, row) => (batches[table] ??= []).push(row);
  let reportSeq = 0;

  for (let i = 0; i < assessments; i += 1) {
    const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
    const owner = owners[i % owners.length].id;
    const id = uid("assessment", i);
    const terminal = TERMINAL.has(status);
    manifest.assessments.byStatus[status] =
      (manifest.assessments.byStatus[status] ?? 0) + 1;
    manifest.assessments[terminal ? "terminal" : "nonTerminal"] += 1;
    manifest.ids[terminal ? "terminal" : "nonTerminal"].push(id);
    add("Assessment", {
      id,
      ownerId: owner,
      name: `W6 assessment ${i}`,
      description: `synthetic V1 assessment ${i}`,
      status,
      createdAt: at(i),
      updatedAt: at(i + 5),
    });

    // Interview + wizard residue: archived privately, never promoted.
    if (
      [
        "WIZARD_IN_PROGRESS",
        "WIZARD_SUBMITTED",
        "READY_FOR_REVIEW",
        "CLASSIFICATION_LOCKED",
      ].includes(status)
    ) {
      add("AssessmentInterviewThread", {
        id: uid("interview", i),
        assessmentId: id,
        stateJson: json({ answers: { q1: "yes" }, note: `private ${i}` }),
        updatedAt: at(i + 2),
      });
    }

    // Repository connection + snapshots (drives the backfill pin).
    // Decoupled from the status cycle so every status meets every repository shape.
    const slot = (7 * i + Math.floor(i / 10)) % 10;
    const hasRepo = status !== "WIZARD_IN_PROGRESS";
    const scanned = [
      "SCAN_IN_PROGRESS",
      "CLASSIFICATION_LOCKED",
      "READY_FOR_REVIEW",
      "AI_NOT_DETECTED",
      "EVIDENCE_REQUIRED",
    ].includes(status);
    let usableSnapshot = null;
    const snapshotIds = [];
    if (hasRepo && slot !== 7) {
      const connection = uid("connection", i);
      const revoked = slot === 5; // revoked connection -> snapshot not usable
      add("RepositoryConnection", {
        id: connection,
        assessmentId: id,
        installationId: "inst-w6",
        repositoryName: "repo",
        repositoryId: `repo-${i}`,
        status: revoked ? "REVOKED" : "ACTIVE",
        userId: owner,
        repositoryFullName: "acme/repo",
        defaultBranch: "main",
        permissions: json({}),
        revokedAt: revoked ? at(i + 3) : null,
      });
      const badCommit = slot === 9; // malformed commit -> not usable
      const snapshots = slot === 8 ? 2 : 1; // two snapshots: the newest usable one wins
      for (let s = 0; s < snapshots; s += 1) {
        const snapshot = uid("snapshot", `${i}-${s}`);
        snapshotIds.push(snapshot);
        add("RepositorySnapshot", {
          id: snapshot,
          assessmentId: id,
          connectionId: connection,
          repositoryId: `repo-${i}`,
          repositoryFullName: "acme/repo",
          branch: "main",
          ref: "refs/heads/main",
          commitSha: badCommit
            ? "abc123"
            : md5(`commit-${i}-${s}`) + md5(`c2-${i}-${s}`).slice(0, 8),
          providerMetadata: json({}),
          actorId: owner,
          status: "READY",
          createdAt: at(i + 4 + s),
        });
        if (!badCommit && !revoked && (snapshots === 1 || s === snapshots - 1))
          usableSnapshot = snapshot;
      }
    }
    if (!terminal) {
      const reason =
        snapshotIds.length === 0
          ? "NO_SNAPSHOT"
          : usableSnapshot
            ? "PINNED_LATEST_READY_SNAPSHOT"
            : "NO_USABLE_SNAPSHOT";
      manifest.expectedBackfillReasons[reason] += 1;
      manifest.ids[
        usableSnapshot ? "withUsableSnapshot" : "withoutUsableSnapshot"
      ].push(id);
    }

    // Scan chain.
    if (scanned && snapshotIds.length > 0) {
      const snapshot = snapshotIds[snapshotIds.length - 1];
      const scanJob = uid("scanjob", i);
      const scanStatus =
        status === "SCAN_IN_PROGRESS"
          ? [
              "QUEUED",
              "RUNNING",
              "PENDING_MAPPING",
              "WAITING_FOR_CONTEXT",
              "WAITING_FOR_CREDITS",
              "READY_TO_SNAPSHOT",
            ][i % 6]
          : status === "EVIDENCE_REQUIRED"
            ? ["FAILED", "BLOCKED", "BLOCKED_MAPPING"][i % 3]
            : "COMPLETED";
      if (
        [
          "QUEUED",
          "RUNNING",
          "PENDING_MAPPING",
          "WAITING_FOR_CONTEXT",
          "WAITING_FOR_CREDITS",
          "READY_TO_SNAPSHOT",
        ].includes(scanStatus)
      )
        manifest.inFlight.REPOSITORY_SCAN_JOB += 1;
      add("RepositoryScanJob", {
        id: scanJob,
        assessmentId: id,
        snapshotId: snapshot,
        idempotencyKey: `scan-${i}`,
        triggerSource: "MANUAL",
        status: scanStatus,
        correlationId: `corr-scan-${i}`,
        createdAt: at(i + 6),
        updatedAt: at(i + 7),
      });
      if (scanStatus === "COMPLETED") {
        const evidence = uid("evidence", i);
        add("TechnicalEvidenceReport", {
          id: evidence,
          scanJobId: scanJob,
          assessmentId: id,
          snapshotId: snapshot,
          toolsVersion: json({ t: 1 }),
          configHash: json({ h: "x" }),
          evidencePayload: json({ findings: [i] }),
          privacyFlags: json({}),
          schemaVersion: "v1",
        });
        const profile = uid("profile", i);
        add("TechnicalProfile", {
          id: profile,
          evidenceReportId: evidence,
          assessmentId: id,
          schemaVersion: "v1",
          providerVersion: "p1",
          profileData: json({ stack: ["ts"] }),
          privacyFlags: json({}),
        });
        if (status !== "AI_NOT_DETECTED") {
          const flow = uid("aiflow", i);
          add("AIUsageFlow", {
            id: flow,
            technicalProfileId: profile,
            assessmentId: id,
            schemaVersion: "v1",
            providerVersion: "p1",
            claims: json([]),
            unknownUsages: json([]),
            privacyFlags: json({}),
          });
          add("ConflictRecord", {
            id: uid("conflict", i),
            aiUsageFlowId: flow,
            assessmentId: id,
            conflictType: "MISMATCH",
            conflictScore: 0.5,
            scoreExplanation: "synthetic",
            evidenceRefs: json([]),
          });
          const verified = uid("verified", i);
          add("VerifiedProfile", {
            id: verified,
            aiUsageFlowId: flow,
            assessmentId: id,
            technicalEvidenceReportId: evidence,
            schemaVersion: "v1",
            providerVersion: "p1",
            profileData: json({}),
            gatesPassedAt: json({}),
          });
          const match = uid("match", i);
          add("LegalRuleMatch", {
            id: match,
            verifiedProfileId: verified,
            assessmentId: id,
            corpusVersionId: corpusA,
            legalRuleCatalogVersionId: catalog,
            schemaVersion: "v1",
            matches: json([]),
            citationAllowlist: json([]),
          });
          const classification = uid("classification", i);
          add("ClassificationResult", {
            id: classification,
            assessmentId: id,
            legalRuleMatchId: match,
            verifiedProfileId: verified,
          });
          add("ClassificationReviewRequest", {
            id: uid("review", i),
            legalRuleMatchId: match,
            assessmentId: id,
            proposalGateRef: "gate",
            baselineRef: "base",
            candidateLabel: "HIGH_RISK",
            citationRefs: json([]),
            requestedById: owner,
            idempotencyKey: `review-${i}`,
            expiresAt: at(i + 9000),
          });
          if (status === "SCAN_IN_PROGRESS") {
            // targeted reanalysis in flight against the evidence above
          }
          // Document requests ------------------------------------------------------------------
          const requests = [];
          if (status === "READY_FOR_REVIEW") {
            requests.push(["FINAL_REPORT", "READY"]);
            if (i % 2 === 0) requests.push(["GAP_ANALYSIS", "READY"]);
            if (i % 11 === 0) requests.push(["GAP_ANALYSIS", "FAILED"]);
            if (i % 13 === 0) requests.push(["FINAL_REPORT", "BLOCKED"]);
          } else if (status === "CLASSIFICATION_LOCKED") {
            requests.push([
              i % 2 === 0 ? "FINAL_REPORT" : "GAP_ANALYSIS",
              i % 3 === 0 ? "QUEUED" : "GENERATING",
            ]);
            manifest.inFlight.DOCUMENT_REQUEST += 1;
          }
          for (const [documentType, requestStatus] of requests) {
            const docId = uid(
              "docreq",
              `${i}-${documentType}-${requestStatus}`,
            );
            let documentUrl = null;
            let blockedReason = null;
            if (requestStatus === "READY") {
              const k = reportSeq++ % 10;
              if (k <= 6) {
                documentUrl = `https://mock-storage.local/documents/gap-analysis/${docId}-${md5(docId).slice(0, 6)}.md`;
                tally(
                  "NO_LEGACY_ARTIFACT_PRESENT/PLACEHOLDER_UPLOADER_NEVER_PERSISTED",
                );
              } else if (k === 7) {
                const bytes = Buffer.from(
                  `# Persisted legacy report ${docId}\n\nsynthetic bytes ${md5(docId)}\n`,
                  "utf8",
                );
                const file = path.join(reportsDir, `${docId}.md`);
                writeFileSync(file, bytes);
                documentUrl = pathToFileURL(file).href;
                manifest.reports.persistedFixtures.push({
                  documentRequestId: docId,
                  path: file,
                  sha256: sha256(bytes),
                  sizeBytes: bytes.length,
                });
                tally("ARTIFACT_PRESENT_AND_COPIED/COPIED_AND_VERIFIED");
              } else if (k === 8) {
                documentUrl = pathToFileURL(
                  path.join(reportsDir, `missing-${docId}.md`),
                ).href;
                tally(
                  "INVALID_OR_ORPHANED_LEGACY_REFERENCE/REFERENCE_TARGET_MISSING",
                );
              } else {
                documentUrl = null; // READY without a reference
                tally("METADATA_ONLY_LEGACY_RECORD/READY_WITHOUT_REFERENCE");
              }
            } else {
              if (requestStatus === "BLOCKED")
                blockedReason = "CLASSIFICATION_REVIEW_PENDING";
              tally("METADATA_ONLY_LEGACY_RECORD/NO_ARTIFACT_REFERENCE");
            }
            add("DocumentRequest", {
              id: docId,
              assessmentId: id,
              requestedById: owner,
              classificationResultId: classification,
              correlationId: `corr-doc-${i}`,
              createdAt: at(i + 10),
              updatedAt: at(i + 11),
              documentUrl,
              blockedReason,
              documentType,
              status: requestStatus,
            });
          }
          // Readiness export (inline content = real persisted artifact).
          if (status === "READY_FOR_REVIEW") {
            add("ReadinessExport", {
              id: uid("export", i),
              assessmentId: id,
              ownerId: owner,
              version: 1,
              contentJson: json({ readiness: "synthetic", assessment: i }),
              generatedAt: at(i + 12),
              status: "GENERATED",
            });
            tally("ARTIFACT_PRESENT_AND_COPIED/INLINE_CONTENT_ARCHIVED");
          }
        } else {
          add("ReadinessExport", {
            id: uid("export", i),
            assessmentId: id,
            ownerId: owner,
            version: 1,
            contentJson: null,
            blockedReason: "AI_NOT_DETECTED",
            generatedAt: at(i + 12),
            status: "BLOCKED",
          });
          tally("METADATA_ONLY_LEGACY_RECORD/NO_INLINE_CONTENT");
        }

        // Targeted reanalysis, in flight for SCAN_IN_PROGRESS-like rows, terminal otherwise.
        if (status !== "AI_NOT_DETECTED" && i % 3 === 0) {
          const inFlight = !terminal;
          const state = inFlight
            ? ["QUEUED", "DISPATCHED", "RUNNING"][i % 3]
            : "COMPLETED";
          const request = uid("targeted", i);
          add("TargetedReanalysisRequest", {
            id: request,
            assessmentId: id,
            inputEvidenceReportId: evidence,
            snapshotId: snapshot,
            commitSha: "d".repeat(40),
            analyzerId: "analyzer",
            normalizedScope: json({}),
            reasonRequirementId: "req",
            idempotencyKey: `targeted-${i}`,
            state,
            checkpointRef: `ckpt-${i}`,
            correlationId: `corr-targeted-${i}`,
            createdAt: at(i + 13),
            updatedAt: at(i + 14),
            scanJobId: scanJob,
          });
          const checkpointState = inFlight
            ? ["PENDING_DISPATCH", "DISPATCHED", "RUNNING", "RETRY_SCHEDULED"][
                i % 4
              ]
            : "COMPLETED";
          add("TargetedReanalysisCheckpoint", {
            id: uid("checkpoint", i),
            requestId: request,
            state: checkpointState,
            correlationId: `corr-ckpt-${i}`,
            createdAt: at(i + 13),
            updatedAt: at(i + 14),
          });
          if (inFlight) {
            manifest.inFlight.TARGETED_REANALYSIS_REQUEST += 1;
            manifest.inFlight.TARGETED_REANALYSIS_CHECKPOINT += 1;
          }
        }
      }
    }

    // Runtime turns (V1 pause/resume control) — RUNNING/STOP_REQUESTED/RESUME_REQUESTED are in flight.
    const turnState = terminal
      ? "COMPLETED"
      : [
          "RUNNING",
          "STOP_REQUESTED",
          "STOPPED",
          "RESUME_REQUESTED",
          "COMPLETED",
        ][i % 5];
    if (["RUNNING", "STOP_REQUESTED", "RESUME_REQUESTED"].includes(turnState))
      manifest.inFlight.ASSESSMENT_RUNTIME_TURN += 1;
    add("AssessmentRuntimeTurn", {
      id: uid("turn", i),
      assessmentId: id,
      threadId: `v1-thread-${i}`,
      boundary: "assessment_pipeline",
      logicalRunId: `logical-${i}`,
      correlationId: `corr-turn-${i}`,
      state: turnState,
      contextJson: json({ v1: true }),
      createdAt: at(i + 1),
      updatedAt: at(i + 8),
    });
    for (let e = 1; e <= 2; e += 1)
      add("AssessmentRuntimeEvent", {
        id: uid("runtimeevent", `${i}-${e}`),
        assessmentId: id,
        runId: `logical-${i}`,
        correlationId: `corr-turn-${i}`,
        sequence: e,
        eventType: e === 1 ? "RUN_STARTED" : "RUN_COMPLETED",
        runStatus: e === 1 ? "RUNNING" : "COMPLETED",
        stage: "SCAN",
        summary: `event ${e}`,
        createdAt: at(i + e),
      });
    if (i % 4 === 0)
      add("AssessmentPipelineReconciliation", { assessmentId: id });
    if (i % 5 === 0)
      add("EngineeringRuleAssessment", {
        id: uid("eraudit", i),
        assessmentId: id,
        engineeringRuleId: "ER-1",
        engineeringRuleVersion: "v1",
        repositoryVersion: "r1",
        contextRevision: 1,
        status: "COMPLETED",
        resultId: `result-${i}`,
        criteria: json([]),
        execution: json({}),
        attempt: 1,
        updatedAt: at(i + 15),
      });
    if (i % 6 === 0)
      add("VerifiedAgentEpisode", {
        id: uid("episode", i),
        assessmentId: id,
        ownerAgent: "v1-agent",
        artifactVersions: json({}),
        trustLevel: "LOW",
        validationStatus: "VERIFIED",
        schemaVersion: "v1",
        contentHash: sha256(`episode-${i}`),
        domainKey: "domain",
        inputSignature: "sig",
        successfulStrategySummary:
          "synthetic V1 memory (must NOT become V2 memory)",
        evidenceRefs: [],
        promptVersion: "p1",
        modelId: "m1",
        summary: "s",
        handoffJson: json({}),
        updatedAt: at(i + 16),
      });
    if (i % 7 === 0) {
      add("DecisionModelDecision", {
        decisionId: uid("decision", i),
        decisionType: "CLASSIFICATION",
        assessmentId: id,
      });
      add("DecisionModelEvent", {
        id: uid("decisionevent", i),
        decisionId: uid("decision", i),
        decisionType: "CLASSIFICATION",
        eventType: "PROPOSED",
        payloadJson: json({}),
        assessmentId: id,
      });
    }
  }

  const order = [
    "Assessment",
    "AssessmentInterviewThread",
    "RepositoryConnection",
    "RepositorySnapshot",
    "RepositoryScanJob",
    "TechnicalEvidenceReport",
    "TechnicalProfile",
    "AIUsageFlow",
    "ConflictRecord",
    "VerifiedProfile",
    "LegalRuleMatch",
    "ClassificationResult",
    "ClassificationReviewRequest",
    "DocumentRequest",
    "ReadinessExport",
    "TargetedReanalysisRequest",
    "TargetedReanalysisCheckpoint",
    "AssessmentRuntimeTurn",
    "AssessmentRuntimeEvent",
    "AssessmentPipelineReconciliation",
    "EngineeringRuleAssessment",
    "VerifiedAgentEpisode",
    "DecisionModelDecision",
    "DecisionModelEvent",
  ];
  for (const table of order) {
    const rows = batches[table] ?? [];
    await insert(client, table, rows);
    count(table, rows.length);
  }

  // ---- outbox: every retired type in every undelivered state, plus kept traffic ----------------
  const outbox = [];
  const anchor = uid("assessment", 0);
  let seq = 0;
  const message = (eventType, status, extra = {}) => {
    const sequence = seq++;
    outbox.push({
      id: uid("outbox", sequence),
      aggregateType: "ASSESSMENT",
      aggregateId: anchor,
      eventType,
      payload: json({ synthetic: sequence }),
      status,
      attempts: status === "PENDING" ? 0 : 3,
      createdAt: at(sequence),
      ...extra,
    });
  };
  for (const eventType of LEGACY_EVENT_TYPES) {
    let cancelled = 0;
    for (let n = 0; n < 3; n += 1)
      (message(eventType, "PENDING"), (cancelled += 1));
    message(eventType, "FAILED", {
      nextAttemptAt: at(60_000),
      errorMessage: "transient",
    });
    message(eventType, "FAILED", {
      nextAttemptAt: null,
      errorMessage: "exhausted",
    });
    message(eventType, "DLQ", { errorMessage: "dead-lettered" });
    cancelled += 3;
    message(eventType, "PUBLISHED", { publishedAt: at(5) });
    manifest.outbox.byLegacyType[eventType] = cancelled;
    manifest.outbox.cancelled += cancelled;
    manifest.outbox.publishedLegacy += 1;
  }
  for (const eventType of KEPT_EVENT_TYPES) {
    message(eventType, "PENDING");
    manifest.outbox.keptUndelivered += 1;
  }
  await insert(client, "OutboxMessage", outbox);
  count("OutboxMessage", outbox.length);

  return manifest;
}
