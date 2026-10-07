#!/usr/bin/env node
// W2 gate: the replaced V1 legal authorities (human LegalRule approval/signoff, draft/approve/
// publish/discard writes, regex normative classifiers, assessment-triggered recovery/lazy
// compile, EngineeringRule cache/bundle authority, legal triage) have ZERO production
// callers/writers. Only the validated LegalPortfolioVersion vertical may author legal output.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SCAN_ROOTS = ["apps/api/src", "apps/web/src", "packages", "deepagents", "scripts", "deepagents-langgraph"];
const EXCLUDED =
  /(^|\/)(node_modules|dist|\.venv|\.mda|\.uv-cache|\.next|__pycache__|\.ruff_cache|\.langgraph_api|tests?|migrations)\/|\.(spec|test)\.[cm]?[jt]sx?$|scripts\/check-legal-v1-authority-retired\.mjs$|\.md$|\.lock$/;

const RETIRED = [
  // API writers / authority
  [/\bDraftLegalRule(Command|Handler|Request)?\b/, "human LegalRule draft authoring"],
  [/\bApproveRuleCatalogVersion(Command|Handler|Request)?\b/, "human LegalRule catalog approval"],
  [/\bRuleCatalogVersionService\b/, "V1 catalog version/recovery service"],
  [/recoverApprovedRulesFromActiveCorpus|recover_legal_rules_from_active_corpus/, "regex LegalRule recovery factory"],
  [/rules\/recover-from-active-corpus|versions\/:versionId\/approve|:versionId\/(publish|discard)/, "retired write route"],
  [/\b(requireApprovedReviewSignoff|legalChunkNormativeClass|LEGAL_ENGINEERING_OBLIGATION_TERMS)\b/, "human signoff / normative regex judge"],
  [/\bdiscardDraft\b|corpusDiscardReceipt\.create/, "human discard authority"],
  [/\b(legalRule|legalRuleCatalogVersion|ruleApprovalRecord)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, "V1 LegalRule table writer"],
  // Python authority
  [/legal_rule_triage|maintain_legal_catalog|TriageSingleton|triage_progress|triage_singleton/, "legal triage authority"],
  [/get_or_compile|prepare_from_triage|EngineeringRuleCache|PrecompiledEngineeringRuleRegistry|EngineeringRuleCompiler|EngineeringRuleService/, "assessment-time compile/cache/bundle authority"],
  [/normative_chunk_filter|legal_chunk_normative_class|WaitingAssessmentRegistry/, "normative classifier / readiness wait"],
  [/humanLegalSignoffRequired|LEGAL_CATALOG_MAINTENANCE|recoverLegalRulesOnly|deferActivation/, "human signoff / lazy recovery flag"],
  [/legal_rule_triage_requested|command\.legal-rule-triage\.requested/, "legal triage registration"],
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...SCAN_ROOTS], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((file) => file && !EXCLUDED.test(file) && /\.(ts|tsx|mjs|js|py|json|yaml|yml|toml)$|Dockerfile/.test(file));

const violations = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  for (const [pattern, label] of RETIRED) {
    const match = pattern.exec(text);
    if (match) violations.push(`${file}: ${label} (${match[0]})`);
  }
}

if (violations.length > 0) {
  console.error("Retired V1 legal authority is still referenced by production code:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(`check:legal-v1-retired OK (${files.length} production files, ${RETIRED.length} retired patterns, 0 references)`);
