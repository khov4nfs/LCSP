import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";

if (process.argv[2] === "--self-check") {
  const canary = ".canonical-terminology-self-check.txt";
  assert.equal(existsSync(canary), false, "self-check must not overwrite existing work");
  try {
    writeFileSync(canary, "LegalCorpus LegalPortfolio EngineeringRule LegalPreparation\n");
    const result = spawnSync(process.execPath, [process.argv[1]], { encoding: "utf8" });
    const report = JSON.parse(result.stdout);
    assert.notEqual(result.status, 0);
    assert.equal(report.defects.find((hit) => hit.file === canary)?.classification, "DEFECT");
    assert.deepEqual(report.defects.find((hit) => hit.file === canary)?.matches,
      ["LegalCorpus", "LegalPortfolio", "EngineeringRule", "LegalPreparation"]);
  } finally {
    unlinkSync(canary);
  }
  console.log("PASS: active retired names fail the audit without touching existing work");
  process.exit(0);
}

// Retirement checks and upgrade fixtures must retain the exact names they reject or upgrade.
const retired = /LegalCorpus|LegalPortfolio|LegalPreparation|EngineeringRule|legal-corpus|legal-portfolio|legal-preparation|engineeringRule|portfolioVersion|legalPortfolioVersion|portfolioRule|portfolioDigest|LegalRule|legalRule|LEGAL_RULE|legal_rule|legal-rule|\bcorpus\b|Corpus|CORPUS|\bportfolio\b|Portfolio|PORTFOLIO|engineering[_ -]rule|ENGINEERING_RULE|LEGAL_PREPARATION|legal_preparation/g;
const fixtures = new Set([
  "tests/canonical-physical-terminology-migration.py",
  "tests/compliance-rule-set-terminology-migration.py",
  "tests/assessment-canonical-persistence.mjs",
  "tests/retired-authority-migration-check.py",
]);
const checks = new Set([
  "scripts/check-canonical-terminology.mjs",
  ".gitignore",
  ".dockerignore",
  "scripts/check-legal-v1-authority-retired.mjs",
  "scripts/purge-retired-assessment-state.py",
  "apps/api/src/platform/outbox/retired-event-policy.ts",
  "tests/fixtures/retired-routes.json",
  "tests/fixtures/retired-image-paths.json",
  "tests/fixtures/outbox-event-policy.json",
  "deepagents/tests/test_deep_agent_project.py",
]);
const paths = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0"))].filter(Boolean).sort();
const output = process.argv[2];
const hits = [];
for (const file of paths) {
  if (!existsSync(file) || file === output) continue;
  const source = readFileSync(file);
  if (source.includes(0)) continue;
  const text = source.toString("utf8");
  let freezeSection = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const section = /^## (\d+)\./.exec(line);
    if (section) freezeSection = Number(section[1]);
    const matches = [...line.matchAll(retired)].map((match) => match[0]);
    if (!matches.length) continue;
    let classification = "DEFECT";
    let reason = "unclassified active vocabulary";
    if (file.includes("/prisma/migrations/")) {
      classification = "HISTORICAL_MIGRATION"; reason = "ordered historical identity or forward rename input";
    } else if (fixtures.has(file)) {
      classification = "MIGRATION_REHEARSAL_FIXTURE"; reason = "old physical schema is the upgrade input";
    } else if (checks.has(file) || (file === "tests/release-images.py" && (line.includes("app/apps/api/dist/src/hidden.js") || line.includes("\\.corpus")))) {
      classification = "RETIREMENT_CHECK"; reason = "exact retired identity is intentionally rejected";
    } else if (file === "reports/architecture-freeze-migration-manifest.md") {
      if ([7, 8, 9].includes(freezeSection)) {
        classification = "HISTORICAL_REPORT"; reason = "explicitly historical pre-freeze inventory column";
      }
    } else if (file.startsWith("reports/") || file === "CHANGELOG.md" || file === "deep-research-report.md"
      || file.startsWith("graphify-out/") || file.startsWith("graft/")
      || ((file.startsWith("docs/") || file.startsWith("docs-vn/")) && ((text.includes("Historical pre-freeze documentation.") || text.includes("Historical W6 migration documentation."))
        || file.endsWith(".csv") || file.endsWith("sprint-status.yaml") || file === "docs/architecture/RELEASE_RUNBOOK.md"))) {
      classification = "HISTORICAL_REPORT"; reason = "explicitly historical design, planning artifact or preserved receipt";
    } else if (line.includes("reports/legal-corpus-")) {
      classification = "HISTORICAL_REPORT"; reason = "reference to immutable historical source/artifact bytes";
    }
    hits.push({ file, line: index + 1, matches, classification, reason });
  }
}
const defects = hits.filter((hit) => hit.classification === "DEFECT");
const counts = Object.fromEntries(["HISTORICAL_MIGRATION", "HISTORICAL_REPORT", "MIGRATION_REHEARSAL_FIXTURE", "RETIREMENT_CHECK", "DEFECT"].map((kind) => [kind, hits.filter((hit) => hit.classification === kind).length]));
const report = { scope: "REPOSITORY_WIDE_CANONICAL_TERMINOLOGY_CLASSIFICATION", status: defects.length ? "FAIL" : "PASS", filesSearched: paths.length, activeHits: { LegalCorpus: 0, LegalPortfolio: 0, EngineeringRule: 0, LegalPreparation: 0 }, allowedHistoricalMigrationHits: hits.length - defects.length, counts, hits };
for (const term of Object.keys(report.activeHits)) report.activeHits[term] = defects.filter((hit) => hit.matches.some((match) => match.includes(term))).length;
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, filesSearched: report.filesSearched, counts, defects }, null, 2));
assert.equal(defects.length, 0, "active terminology cutover is incomplete");
