// Independent oracle for the W6 rehearsal: its own table list, its own hashing, no imports from the
// migration tool. If the tool and this file disagree, the rehearsal fails.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Every V1 table the cutover archives. `volatile` = columns quiescence or the backfill may
 * legitimately rewrite on the live row (compared with `stable: true`). `where` = V1-only filter.
 */
export const V1_SOURCES = [
  {
    source: "ASSESSMENT",
    table: "Assessment",
    pk: "id",
    volatile: [
      "lifecycleState",
      "lifecycleRevision",
      "blockerReason",
      "blockerReference",
      "updatedAt",
    ],
  },
  {
    source: "ASSESSMENT_INTERVIEW_THREAD",
    table: "AssessmentInterviewThread",
    pk: "id",
  },
  {
    source: "ENGINEERING_RULE_ASSESSMENT",
    table: "EngineeringRuleAssessment",
    pk: "id",
  },
  {
    source: "ASSESSMENT_RUNTIME_TURN",
    table: "AssessmentRuntimeTurn",
    pk: "id",
    volatile: ["state", "updatedAt"],
    // The V2 Assessment Root records its executions in the same table; those rows are not V1 history.
    where: `t.boundary <> 'ASSESSMENT_ROOT'`,
  },
  {
    source: "ASSESSMENT_RUNTIME_EVENT",
    table: "AssessmentRuntimeEvent",
    pk: "id",
  },
  {
    source: "PIPELINE_RECONCILIATION",
    table: "AssessmentPipelineReconciliation",
    pk: "assessmentId",
  },
  {
    source: "REPOSITORY_SCAN_JOB",
    table: "RepositoryScanJob",
    pk: "id",
    volatile: ["status", "blockedReason", "updatedAt"],
    where: `"idempotencyKey" NOT LIKE 'runtime-hydration:%'`,
  },
  {
    source: "TECHNICAL_EVIDENCE_REPORT",
    table: "TechnicalEvidenceReport",
    pk: "id",
  },
  { source: "TECHNICAL_PROFILE", table: "TechnicalProfile", pk: "id" },
  { source: "AI_USAGE_FLOW", table: "AIUsageFlow", pk: "id" },
  { source: "CONFLICT_RECORD", table: "ConflictRecord", pk: "id" },
  {
    source: "TARGETED_REANALYSIS_REQUEST",
    table: "TargetedReanalysisRequest",
    pk: "id",
    volatile: ["state", "safeFailureCode", "updatedAt"],
  },
  {
    source: "TARGETED_REANALYSIS_CHECKPOINT",
    table: "TargetedReanalysisCheckpoint",
    pk: "id",
    volatile: ["state", "safeFailureCode", "updatedAt"],
  },
  { source: "VERIFIED_AGENT_EPISODE", table: "VerifiedAgentEpisode", pk: "id" },
  { source: "VERIFIED_PROFILE", table: "VerifiedProfile", pk: "id" },
  { source: "CLASSIFICATION_RESULT", table: "ClassificationResult", pk: "id" },
  {
    source: "CLASSIFICATION_REVIEW_REQUEST",
    table: "ClassificationReviewRequest",
    pk: "id",
  },
  { source: "LEGAL_RULE_MATCH", table: "LegalRuleMatch", pk: "id" },
  {
    source: "DOCUMENT_REQUEST",
    table: "DocumentRequest",
    pk: "id",
    volatile: ["status", "blockedReason", "updatedAt"],
  },
  { source: "READINESS_EXPORT", table: "ReadinessExport", pk: "id" },
  {
    source: "DECISION_MODEL_DECISION",
    table: "DecisionModelDecision",
    pk: "decisionId",
  },
  { source: "DECISION_MODEL_EVENT", table: "DecisionModelEvent", pk: "id" },
  {
    source: "LEGAL_RULE_CATALOG_VERSION",
    table: "LegalRuleCatalogVersion",
    pk: "id",
  },
  { source: "LEGAL_RULE", table: "LegalRule", pk: "id" },
  { source: "RULE_APPROVAL_RECORD", table: "RuleApprovalRecord", pk: "id" },
  { source: "CORPUS_APPROVAL_RECORD", table: "CorpusApprovalRecord", pk: "id" },
  { source: "CORPUS_DISCARD_RECEIPT", table: "CorpusDiscardReceipt", pk: "id" },
  { source: "CORPUS_PREPARATION", table: "CorpusPreparation", pk: "id" },
];

const jsonExpr = (spec, stable) =>
  stable && spec.volatile?.length
    ? `(to_jsonb(t) - ARRAY[${spec.volatile.map((c) => `'${c}'`).join(",")}]::text[])`
    : "to_jsonb(t)";

/** Per-table row count and an order-independent content hash. `stable` drops volatile columns. */
export async function fingerprint(
  client,
  { stable = false, sources = V1_SOURCES } = {},
) {
  const result = {};
  for (const spec of sources) {
    const where = spec.where ? `WHERE ${spec.where}` : "";
    const { rows } = await client.query(
      `SELECT count(*)::int AS n,
              md5(coalesce(string_agg(${jsonExpr(spec, stable)}::text, E'\\n' ORDER BY t."${spec.pk}" COLLATE "C"), '')) AS h
         FROM "${spec.table}" t ${where}`,
    );
    result[spec.table] = { n: rows[0].n, h: rows[0].h };
  }
  return result;
}

/** Whole-database fingerprint of a few V2-side tables that must not move on a no-op re-run. */
export async function stateFingerprint(client) {
  const tables = [
    ["LegacyArchiveRecord", `"id"`],
    ["LegacyArchiveBlob", `"recordId"`],
    ["LegacyAssessmentArchive", `"assessmentId"`],
    ["AssessmentRuntime", `"assessmentId"`],
    ["AssessmentCase", `"assessmentId"`],
    ["AssessmentDecisionCoverage", `"assessmentId", "engineeringRuleId"`],
    ["AssessmentArtifact", `"artifactId"`],
    ["OutboxMessage", `"id"`],
  ];
  const result = {};
  for (const [table, order] of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY ${order.replaceAll('"', '"')}), '')) AS h FROM "${table}" t`,
    );
    result[table] = rows[0];
  }
  const audit = await client.query(
    `SELECT "eventType", count(*)::int AS n FROM "AuditEvent" WHERE "eventType" LIKE 'LEGACY_%' OR "eventType" LIKE 'OUTBOX_LEGACY_%' GROUP BY 1 ORDER BY 1`,
  );
  result.audit = Object.fromEntries(audit.rows.map((r) => [r.eventType, r.n]));
  return result;
}

/**
 * Samples archived rows per source and re-verifies each with independent code:
 *  - sha256 of the stored jsonb text, computed here, equals the recorded hash;
 *  - the parsed archive payload equals the live row (volatile columns excluded).
 * Also compares live and archived row COUNTS for every source.
 */
export async function independentArchiveCheck(
  client,
  { sample = 12, seed = "w6" } = {},
) {
  const findings = [];
  const summary = {};
  for (const spec of V1_SOURCES) {
    const where = spec.where ? `WHERE ${spec.where}` : "";
    const live = (
      await client.query(
        `SELECT count(*)::int AS n FROM "${spec.table}" t ${where}`,
      )
    ).rows[0].n;
    const archived = (
      await client.query(
        `SELECT count(*)::int AS n FROM "LegacyArchiveRecord" WHERE "sourceTable" = $1::"LegacyArchiveSource"`,
        [spec.source],
      )
    ).rows[0].n;
    // V1-origin filter for Assessment: V2-native rows are never archived, so compare against that.
    summary[spec.source] = { live, archived, sampled: 0 };
    if (live !== archived)
      findings.push(`${spec.source}: live ${live} != archived ${archived}`);
    const picks = await client.query(
      `SELECT "sourceId", payload::text AS text, "payloadSha256" AS sha FROM "LegacyArchiveRecord"
        WHERE "sourceTable" = $1::"LegacyArchiveSource" ORDER BY md5("sourceId" || $2) LIMIT $3`,
      [spec.source, seed, sample],
    );
    for (const pick of picks.rows) {
      summary[spec.source].sampled += 1;
      if (sha256(pick.text) !== pick.sha)
        findings.push(
          `${spec.source}/${pick.sourceId}: stored sha256 mismatch`,
        );
      const liveRow = await client.query(
        `SELECT ${jsonExpr(spec, true)} AS j FROM "${spec.table}" t WHERE t."${spec.pk}" = $1`,
        [pick.sourceId],
      );
      const archivedJson = JSON.parse(pick.text);
      for (const column of spec.volatile ?? []) delete archivedJson[column];
      try {
        assert.deepStrictEqual(archivedJson, liveRow.rows[0]?.j);
      } catch {
        findings.push(
          `${spec.source}/${pick.sourceId}: archived payload differs from live row`,
        );
      }
    }
  }
  return { findings, summary };
}

/**
 * Everything an AI execution could touch in billing/usage accounting, as order-independent
 * per-table fingerprints. A migration (and a start that no worker has executed yet) must leave
 * every one of them byte-identical; only real usage may add `LlmUsageEvent` rows.
 */
export const ACCOUNTING_TABLES = [
  "LlmUsageEvent",
  "BillingReservation",
  "BillingReservationInvocationClaim",
  "BillingWallet",
  "CreditLedgerEntry",
  "BillingOrder",
  "ModelPricingSnapshot",
  "RuntimeModelPolicySnapshot",
];

export async function accountingFingerprint(client) {
  const result = {};
  for (const table of ACCOUNTING_TABLES) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n,
              md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"), '')) AS h
         FROM "${table}" t`,
    );
    result[table] = rows[0];
  }
  return result;
}

/** The accounting tables that real usage must NEVER move (usage is telemetry, not a debit). */
export const ACCOUNTING_TABLES_NEVER_MOVED_BY_USAGE = ACCOUNTING_TABLES.filter(
  (table) =>
    !["LlmUsageEvent", "ModelPricingSnapshot", "RuntimeModelPolicySnapshot"].includes(
      table,
    ),
);
