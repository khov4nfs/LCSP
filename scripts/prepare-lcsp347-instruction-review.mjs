import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../deepagents");
const output = path.resolve(
  import.meta.dirname,
  "../docs/implementation-artifacts/lcsp347-pm-rereview/instruction-equivalence.pending.json",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = JSON.parse(
  readFileSync(path.join(root, "instructions/inventory.json"), "utf8"),
);
const manifestBytes = readFileSync(
  path.join(root, "instructions/candidates/r1/manifest.pending.json"),
);
const manifest = JSON.parse(manifestBytes);
if (manifest.approvalStatus !== "PENDING")
  throw Error(
    "This exporter requires the unapproved candidate; release approval is external",
  );
const ids = new Set();
const entries = inventory.entries.map((entry) => {
  if (ids.has(entry.sourceId)) throw Error("Duplicate source identity");
  ids.add(entry.sourceId);
  const pinned = manifest.entries.find(
    (row) => row.sourceId === entry.sourceId,
  );
  if (!pinned) throw Error(`Missing candidate ${entry.sourceId}`);
  const read = (relative, expected) => {
    const target = realpathSync(path.resolve(root, relative));
    if (!target.startsWith(realpathSync(root) + path.sep))
      throw Error("Unsafe source path");
    const bytes = readFileSync(target);
    if (hash(bytes) !== expected)
      throw Error(`Content digest drift: ${relative}`);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return value;
  };
  const vi = read(pinned.vietnameseSourcePath, pinned.vietnameseSourceSha256),
    en = read(pinned.englishRuntimePath, pinned.englishRuntimeSha256);
  if (
    entry.vietnameseSourceRevision !== pinned.vietnameseSourceRevision ||
    entry.englishCandidatePath !== pinned.englishRuntimePath ||
    entry.candidateOriginSha256 !== pinned.vietnameseSourceSha256 ||
    entry.sourceSha256 !== pinned.vietnameseSourceSha256 ||
    entry.englishCandidateSha256 !== pinned.englishRuntimeSha256
  )
    throw Error("Inventory and manifest disagree");
  const terms = [
    "FULL_SOURCE",
    "DEVELOPMENT_ONLY",
    "Claim Author",
    "Root",
    "Researcher",
    "HITL",
    "Legal Source",
    "Rule Set",
    "sourceId",
    "responseLanguage",
  ].filter((term) => vi.includes(term) || en.includes(term));
  return {
    sourceId: entry.sourceId,
    runtimeEntryId: entry.runtimeEntryId,
    usage: {
      runtimeRole: entry.runtimeRole,
      instructionKind: entry.instructionKind,
      consumers: entry.consumers,
    },
    vietnameseSourcePath: pinned.vietnameseSourcePath,
    vietnameseSourceRevision: pinned.vietnameseSourceRevision,
    vietnameseSha256: pinned.vietnameseSourceSha256,
    englishCandidatePath: pinned.englishRuntimePath,
    englishSha256: pinned.englishRuntimeSha256,
    vietnameseContent: vi,
    englishCandidateContent: en,
    placeholderSchema: entry.placeholderSchema,
    migrationReferences: entry.migrationReferences,
    terminologySensitiveClauses: {
      unreviewedTokenIndex: terms,
      reviewerMustIdentifyExactClauses: true,
    },
    actorAuthorityDistinctions: {
      reviewerEvidence: null,
      checklist: [
        "Actor, duty, phase and scope are unchanged",
        "Root/child/tool authority and read-only restrictions remain exact",
        "Legal-source quotations remain data; no new legal obligation",
      ],
    },
    safetySecurityConstraints: {
      reviewerEvidence: null,
      checklist: [
        "Fail-closed behavior, source pins and tenant boundaries preserved",
        "Completion, resume, compaction and delegation conditions unchanged",
        "No synthetic approval or legacy instruction fallback",
      ],
    },
    potentialSemanticDrift: "NOT_ASSESSED_REQUIRES_INDEPENDENT_REVIEW",
    reviewerDecision: "PENDING_REVIEW",
    reviewerIdentity: null,
    reviewerEvidence: null,
  };
});
if (entries.length !== 59)
  throw Error(
    `Expected reviewed baseline of 59 pairs; found ${entries.length}`,
  );
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, "utf8"));
  if (
    previous.entries.some(
      (entry) =>
        entry.reviewerDecision !== "PENDING_REVIEW" ||
        entry.reviewerIdentity ||
        entry.reviewerEvidence,
    )
  )
    throw Error(
      "Existing independent review evidence must be preserved in its own immutable revision",
    );
}
mkdirSync(path.dirname(output), { recursive: true });
const result = {
  packageKind: "LCSP_INDEPENDENT_EQUIVALENCE_REVIEW_INPUT",
  bundleId: manifest.bundleId,
  candidateManifestSha256: hash(manifestBytes),
  vietnameseInventorySha256: manifest.vietnameseInventorySha256,
  englishBundleSha256: manifest.englishBundleSha256,
  entryCount: entries.length,
  productionApproval: "BLOCKED",
  permittedDecisions: [
    "PENDING_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED_BY_INDEPENDENT_REVIEWER",
  ],
  warning:
    "Review input only. This is not a trusted approval registry or release manifest. Independent reviewer evidence and release authority are required.",
  entries,
};
const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n", "utf8");
writeFileSync(output, bytes);
console.log(
  JSON.stringify({
    entries: entries.length,
    packageSha256: hash(bytes),
    candidateManifestSha256: result.candidateManifestSha256,
    approved: 0,
  }),
);
