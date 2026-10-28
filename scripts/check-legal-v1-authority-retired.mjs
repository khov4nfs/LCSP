#!/usr/bin/env node
// RELEASE: physical production source, contract, route, registration, skill and build-context absence.
// Historical SQL/evidence and mechanical rejection of retired outbox keys are non-authoritative.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SCAN_ROOTS = [
  "apps/api/src",
  "apps/api/package.json",
  "apps/api/prisma/schema.prisma",
  "apps/web/src",
  "apps/web/package.json",
  "packages",
  "deepagents",
  "scripts",
  "deepagents-langgraph",
  ".github/workflows",
  ".fogewise",
  ".env.example",
  ".dockerignore",
  "package.json",
];
const EXCLUDED =
  /(^|\/)(node_modules|dist|\.venv|\.mda|\.uv-cache|\.next|__pycache__|\.ruff_cache|\.langgraph_api|tests?|migrations)\/|\.(spec|test)\.[cm]?[jt]sx?$|scripts\/(check-legal-v1-authority-retired\.mjs|check-canonical-terminology\.mjs|purge-retired-assessment-state\.py)$|\.lock$/;

const RETIRED = [
  [
    /classification-runtime\.ts|\b(CLASSIFICATION_RUNTIME_MESSAGE_KEYS|resolveClassificationRuntimeMessage|formatClassificationRuntimeSummary|formatEngineeringReason)\b/,
    "retired V1 classification/evaluator presentation export",
  ],
  [
    /cleanup_legacy_mda_topology|LCSP_AGENT_RUNTIME_CLEANUP_LEGACY_MDA_TOPOLOGY|lcsp\.mda\.boundary/,
    "retired MDA worker topology/configuration",
  ],
  [
    /dist\/src\/modules\/legacy-migration|demo-readiness-export-pdf/,
    "retired migration/readiness package entrypoint",
  ],
  [
    /legal_corpus_recovery|LegalCorpusRecovery|LEGAL_CORPUS_PREPARATION|complete_legal_corpus_preparation|write_recovery_artifact|recovery-artifacts/,
    "retired legal recovery command, callback or cache",
  ],
  [
    /AdminCorpusVersionsService|admin-corpus-versions|admin\/corpus-versions|preparation-callback/,
    "retired corpus-only admin preparation",
  ],
  [
    /\b(AssessmentInterviewRuntimeService|InitialInterviewContext|CONTEXT_READY|INTERVIEW_GUIDANCE_VERSION|EngineeringRuleEvaluator|RepositoryDeepAnalyzer|AI_NOT_DETECTED|AI_DISCOVERY_FAILED|AI_ABSENCE_BACKSTOP)\b/,
    "Scanner or Interview semantic authority",
  ],
  [
    /interview-context|RootSubagentDispatcher|repository-analyst|deterministic Python per-rule loop/,
    "retired skill or per-rule semantic orchestration",
  ],
  [
    /\b(ConfirmedContextPack|RepositoryIntelligencePack|WaitingAssessmentRegistry|PostGuardContinuationStore|deriveStageLifecycles|checkpointed_invocation|hosted_checkpoint_scope)\b/,
    "duplicate context or lifecycle reconstruction",
  ],
  [
    /\b(TARGETED_REANALYSIS_(?:REQUEST|CHECKPOINT)_STATES|ASSESSMENT_STATUS_CODES|ENGINEERING_RULE_EVALUATION_STATUSES|ENGINEERING_EVIDENCE_CLAIM_TYPES|SCAN_EVENT_TYPES|DOCUMENT_REQUEST_STATUSES)\b/,
    "retired contract export or consumer",
  ],
  [
    /\b(interview_topic_routing|observe_interview_routing|build_interview_routing_request)\b/,
    "Interview shadow decision authority",
  ],
  [
    /\b(model|enum)\s+(AssessmentInterviewThread|EngineeringRuleAssessment|TargetedReanalysisRequest|TargetedReanalysisCheckpoint|TechnicalEvidenceReport|TechnicalProfile|AIUsageFlow|ConflictRecord|VerifiedProfile|ClassificationResult|ClassificationReviewRequest|DocumentRequest|LegacyAssessmentArchive|LegacyMigrationRun|LegacyArchiveRecord|LegacyArchiveBlob|LegacyReevaluation|RuleApprovalRecord|LegalRuleCatalogVersion|CorpusPreparation|WorkflowBillingPause|AssessmentStatus)\b/,
    "obsolete active schema",
  ],
  // API writers / authority
  [
    /\bDraftLegalRule(Command|Handler|Request)?\b/,
    "human LegalRule draft authoring",
  ],
  [
    /\bApproveRuleCatalogVersion(Command|Handler|Request)?\b/,
    "human LegalRule catalog approval",
  ],
  [/\bRuleCatalogVersionService\b/, "V1 catalog version/recovery service"],
  [
    /recoverApprovedRulesFromActiveCorpus|recover_legal_rules_from_active_corpus/,
    "regex LegalRule recovery factory",
  ],
  [
    /rules\/recover-from-active-corpus|versions\/:versionId\/approve|:versionId\/(publish|discard)/,
    "retired write route",
  ],
  [
    /\b(requireApprovedReviewSignoff|legalChunkNormativeClass|LEGAL_ENGINEERING_OBLIGATION_TERMS)\b/,
    "human signoff / normative regex judge",
  ],
  [/corpusDiscardReceipt\.create/, "retired corpus discard receipt writer"],
  [
    /\b(legalRule|legalRuleCatalogVersion|ruleApprovalRecord)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/,
    "V1 LegalRule table writer",
  ],
  // Python authority
  [
    /legal_rule_triage|maintain_legal_catalog|TriageSingleton|triage_progress|triage_singleton/,
    "legal triage authority",
  ],
  [
    /get_or_compile|prepare_from_triage|EngineeringRuleCache|PrecompiledEngineeringRuleRegistry|EngineeringRuleCompiler|EngineeringRuleService/,
    "assessment-time compile/cache/bundle authority",
  ],
  [
    /normative_chunk_filter|legal_chunk_normative_class|WaitingAssessmentRegistry/,
    "normative classifier / readiness wait",
  ],
  [
    /humanLegalSignoffRequired|LEGAL_CATALOG_MAINTENANCE|recoverLegalRulesOnly|deferActivation/,
    "human signoff / lazy recovery flag",
  ],
  [
    /legal_rule_triage_requested|command\.legal-rule-triage\.requested/,
    "legal triage registration",
  ],
  // ASSESSMENT: model-driven Scanner, per-rule callback loop and V1 interview boundaries
  [
    /\b(targeted_reanalysis_requested|engineering_assessment_requested|assessment_interview_resume_requested|assessment_interview_pause_requested)\b/,
    "retired V1 Python boundary registration",
  ],
  [
    /\b(RepositoryAnalysisBoundary|TargetedRepositoryAnalysisBoundary|EngineeringAssessmentBoundary|InterviewGatedEngineeringAssessmentBoundary|SnapshotCreatedAutoScanService)\b/,
    "retired V1 scanner/assessment boundary",
  ],
  [
    /\b(submit_rule_assessment|analyze_rule|TechnicalCoveragePolicy|InterviewRuntimeContext)\b/,
    "V1 per-rule submit/coverage authority",
  ],
];

const forbiddenPaths = [
  /^deepagents\/tools\/legal\/sources\/recovery\//,
  /^deepagents\/tools\/common\/capabilities\/agentic_evidence\/governance\//,
  /^deepagents\/tools\/common\/capabilities\/reporting\/report\/(final_report|projection|delivery|dossiers)\//,
  /^deepagents\/skills\/lcsp\//,
  /^apps\/api\/src\/modules\/(ai-usage-flow|classification|document|evidence|reconciliation|scan|legacy-archive|legacy-migration)\//,
  /^apps\/web\/src\/app\/api\/.*\/(interview|readiness|targeted-reanalysis|post-finding|conflicts|legacy-archive)(\/|$)/,
  /^packages\/contracts\/src\/(scan|document|legacy-migration)\//,
  /interview-context|interview-agent-frozen/,
  /^scripts\/cleanup-legacy-mda-rabbitmq/,
];
// Mutation self-check: the policy must detect static, lazy, and CommonJS legacy imports.
for (const sample of [
  'import { EngineeringRuleEvaluator } from "./judge.js"',
  'import("./interview-context/SKILL.md")',
  'require("./WaitingAssessmentRegistry")',
  'export { formatEngineeringReason } from "./classification-runtime.ts"',
  "LCSP_AGENT_RUNTIME_CLEANUP_LEGACY_MDA_TOPOLOGY=true",
  '"legacy-migration": "node dist/src/modules/legacy-migration/presentation/cli/legacy-migration.cli.js"',
  "await prisma.corpusDiscardReceipt.create({ data: receipt })",
])
  assert.ok(
    RETIRED.some(([pattern]) => pattern.test(sample)),
    sample,
  );

if (process.argv.includes("--policy-json")) {
  console.log(
    JSON.stringify({
      retired: RETIRED.map(([pattern, label]) => ({
        pattern: pattern.source,
        label,
      })),
      forbiddenPaths: forbiddenPaths.map((pattern) => pattern.source),
    }),
  );
  process.exit(0);
}

const files = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...SCAN_ROOTS,
  ],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split("\n")
  .filter(
    (file) =>
      file &&
      !EXCLUDED.test(file) &&
      existsSync(resolve(root, file)) &&
      (/\.(ts|tsx|mjs|js|py|json|yaml|yml|toml|prisma|sh)$|Dockerfile/.test(
        file,
      ) ||
        file === ".dockerignore" ||
        file === ".env.example" ||
        (file.startsWith("deepagents/") && file.endsWith(".md"))),
  );

const violations = [];
for (const file of files) {
  if (forbiddenPaths.some((pattern) => pattern.test(file)))
    violations.push(`${file}: retired production path`);
}
const exports = JSON.parse(
  readFileSync(resolve(root, "packages/contracts/package.json"), "utf8"),
).exports;
for (const [name, target] of Object.entries(exports)) {
  if (
    typeof target !== "string" ||
    !existsSync(resolve(root, "packages/contracts", target))
  )
    violations.push(`contracts export ${name}: unresolved target ${target}`);
  if (/^\.\/(scan|document|legacy-migration)(\/|$)/.test(name))
    violations.push(`contracts export ${name}: retired public surface`);
}
for (const file of files) {
  let text;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  // The outbox fence has no handler, schema, reader or runtime selector.
  if (file === "apps/api/src/platform/outbox/retired-event-policy.ts") continue;
  for (const [pattern, label] of RETIRED) {
    const match = pattern.exec(text);
    if (match) violations.push(`${file}: ${label} (${match[0]})`);
  }
}

if (violations.length > 0) {
  console.error(
    "Retired V1 authority is still present in production source, imports or packaging:\n" +
      violations.join("\n"),
  );
  process.exit(1);
}
console.log(
  `check:legal-v1-retired OK (${files.length} current production/build/CI files, ${RETIRED.length} retired patterns, 0 references)`,
);
