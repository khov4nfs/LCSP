import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  lstatSync,
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
if (
  !Array.isArray(inventory.entries) ||
  !Array.isArray(manifest.entries) ||
  manifest.entries.length !== inventory.entries.length ||
  new Set(manifest.entries.map((entry) => entry.sourceId)).size !==
    manifest.entries.length
)
  throw Error("Incomplete or duplicate manifest source inventory");
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
    entry.vietnameseSourcePath !== pinned.vietnameseSourcePath ||
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
const EXPECTED_INSTRUCTION_PACKAGE_KEYS = new Set([
  "packageKind",
  "bundleId",
  "candidateManifestSha256",
  "vietnameseInventorySha256",
  "englishBundleSha256",
  "entryCount",
  "productionApproval",
  "permittedDecisions",
  "warning",
  "entries",
]);

const EXPECTED_INSTRUCTION_ENTRY_KEYS = new Set([
  "sourceId",
  "runtimeEntryId",
  "usage",
  "vietnameseSourcePath",
  "vietnameseSourceRevision",
  "vietnameseSha256",
  "englishCandidatePath",
  "englishSha256",
  "vietnameseContent",
  "englishCandidateContent",
  "placeholderSchema",
  "migrationReferences",
  "terminologySensitiveClauses",
  "actorAuthorityDistinctions",
  "safetySecurityConstraints",
  "potentialSemanticDrift",
  "reviewerDecision",
  "reviewerIdentity",
  "reviewerEvidence",
]);

function assertUnreviewedInstructionPackage(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("Malformed existing instruction review package");
  if (
    parsed.packageKind !== "LCSP_INDEPENDENT_EQUIVALENCE_REVIEW_INPUT" ||
    parsed.productionApproval !== "BLOCKED" ||
    !Array.isArray(parsed.entries)
  )
    throw Error(
      "Existing independent review evidence must be preserved in its own immutable revision",
    );
  for (const key of Object.keys(parsed)) {
    if (!EXPECTED_INSTRUCTION_PACKAGE_KEYS.has(key))
      throw Error(
        "Existing independent review evidence must be preserved in its own immutable revision",
      );
  }
  for (const entry of parsed.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw Error("Malformed existing instruction review package");
    for (const key of Object.keys(entry)) {
      if (!EXPECTED_INSTRUCTION_ENTRY_KEYS.has(key))
        throw Error(
          "Existing independent review evidence must be preserved in its own immutable revision",
        );
    }
    if (
      entry.reviewerDecision !== "PENDING_REVIEW" ||
      entry.reviewerIdentity !== null ||
      entry.reviewerEvidence !== null ||
      entry.potentialSemanticDrift !==
        "NOT_ASSESSED_REQUIRES_INDEPENDENT_REVIEW" ||
      entry.actorAuthorityDistinctions?.reviewerEvidence !== null ||
      entry.safetySecurityConstraints?.reviewerEvidence !== null
    ) {
      throw Error(
        "Existing independent review evidence must be preserved in its own immutable revision",
      );
    }
  }
}

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
const resolved = path.resolve(output);
const newHash = hash(bytes);

if (existsSync(resolved)) {
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink())
    throw Error(
      "Unsafe output path: symbolic link rejected for instruction review package",
    );
  if (!stat.isFile())
    throw Error(
      "Unsafe output path: non-regular file rejected for instruction review package",
    );

  const existingBuf = readFileSync(resolved);
  if (Buffer.compare(existingBuf, bytes) === 0) {
    console.log(
      JSON.stringify({
        entries: entries.length,
        packageSha256: newHash,
        candidateManifestSha256: result.candidateManifestSha256,
        approved: 0,
        publishOutcome: "IDENTICAL_NOOP",
      }),
    );
    process.exit(0);
  }

  let previous;
  try {
    previous = JSON.parse(existingBuf.toString("utf8"));
  } catch {
    throw Error(
      "Existing instruction review package is malformed JSON; refusing to overwrite existing evidence",
    );
  }
  assertUnreviewedInstructionPackage(previous);

  throw Error(
    "Existing instruction review package differs from generated content; refusing to overwrite",
  );
}

mkdirSync(path.dirname(resolved), { recursive: true });
try {
  writeFileSync(resolved, bytes, { flag: "wx" });
  console.log(
    JSON.stringify({
      entries: entries.length,
      packageSha256: newHash,
      candidateManifestSha256: result.candidateManifestSha256,
      approved: 0,
      publishOutcome: "CREATED",
    }),
  );
} catch (err) {
  if (err && typeof err === "object" && err.code === "EEXIST") {
    const existingBuf = readFileSync(resolved);
    if (Buffer.compare(existingBuf, bytes) === 0) {
      console.log(
        JSON.stringify({
          entries: entries.length,
          packageSha256: newHash,
          candidateManifestSha256: result.candidateManifestSha256,
          approved: 0,
          publishOutcome: "IDENTICAL_NOOP",
        }),
      );
      process.exit(0);
    }
    throw Error(
      "Concurrent modification detected: existing instruction review package differs from generated content; refusing to overwrite",
    );
  }
  throw err;
}
