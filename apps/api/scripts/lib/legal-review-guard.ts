import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  linkSync,
  rmSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const EXPECTED_TOP_LEVEL_KEYS = new Set([
  "packageKind",
  "source",
  "classificationPerformed",
  "approvedGold",
  "candidates",
  "requiredIndependentControls",
  "warning",
]);

const EXPECTED_CANDIDATE_KEYS = new Set([
  "caseId",
  "searchPhrases",
  "mappingStatus",
  "warning",
  "sourceTextCandidates",
  "actor",
  "action",
  "trigger",
  "lifecycleStage",
  "developerApplicability",
  "expectedDecision",
  "independentReviewerIdentity",
  "goldRevision",
  "goldHash",
]);

const EXPECTED_SOURCE_TEXT_KEYS = new Set([
  "id",
  "documentId",
  "locator",
  "contentSha256",
  "legalStatus",
  "legalEffectStatus",
  "sourceText",
  "sourceSha256",
  "hashVerified",
  "effectMetadataAvailable",
]);

const KNOWN_REVIEW_NULL_FIELDS = [
  "actor",
  "action",
  "trigger",
  "lifecycleStage",
  "developerApplicability",
  "expectedDecision",
  "independentReviewerIdentity",
  "goldRevision",
  "goldHash",
];

/**
 * Business purpose: Prevent candidate export retries from overwriting legal reviewer work.
 * Business rules: Only an explicitly unreviewed candidate artifact with null review fields and no unknown annotations can be considered unreviewed. Absence of approval is not legal gold.
 * Execution flow: Check package discriminator, approval state, structural key conformance, and every review annotation field before allowing a candidate to be considered unreviewed.
 * Failure cases: Malformed artifacts, unexpected top-level or nested keys, altered mapping statuses, and any non-null review annotation reject replacement.
 * Side effects: Pure validation; no approval, canonical mutation, or filesystem modification.
 */
export function assertUnreviewedLegalCandidate(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Malformed existing legal review artifact");
  const document = value as Record<string, unknown>;
  if (
    document.packageKind !== "UNREVIEWED_PINNED_LEGAL_RETRIEVAL_CANDIDATES" ||
    document.approvedGold !== false ||
    document.classificationPerformed !== false ||
    !Array.isArray(document.candidates)
  )
    throw Error("Existing legal review evidence must not be overwritten");

  for (const key of Object.keys(document)) {
    if (!EXPECTED_TOP_LEVEL_KEYS.has(key))
      throw Error("Existing legal review annotations must not be overwritten");
  }

  for (const item of document.candidates) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error("Malformed existing legal review candidate");
    const row = item as Record<string, unknown>;
    if (row.mappingStatus !== "PENDING_INDEPENDENT_REVIEW")
      throw Error("Existing legal review annotations must not be overwritten");

    for (const field of KNOWN_REVIEW_NULL_FIELDS) {
      if (row[field] !== null)
        throw Error(
          "Existing legal review annotations must not be overwritten",
        );
    }

    for (const key of Object.keys(row)) {
      if (!EXPECTED_CANDIDATE_KEYS.has(key))
        throw Error(
          "Existing legal review annotations must not be overwritten",
        );
    }

    if (!Array.isArray(row.sourceTextCandidates))
      throw Error("Malformed existing legal review candidate");

    for (const textItem of row.sourceTextCandidates) {
      if (!textItem || typeof textItem !== "object" || Array.isArray(textItem))
        throw Error("Malformed existing legal review candidate");
      const textRow = textItem as Record<string, unknown>;
      for (const key of Object.keys(textRow)) {
        if (!EXPECTED_SOURCE_TEXT_KEYS.has(key))
          throw Error(
            "Existing legal review annotations must not be overwritten",
          );
      }
    }
  }
}

export interface SafePublishReviewArtifactOptions {
  outputPath: string;
  generatedBytes: string;
  validateExisting?: (parsed: unknown) => void;
  artifactKindLabel?: string;
}

export interface SafePublishReviewArtifactResult {
  outcome: "CREATED" | "IDENTICAL_NOOP";
  bytes: Buffer;
  sha256: string;
}

/**
 * Business purpose: Publish review artifacts safely without silently destroying, corrupting, or losing human review evidence.
 * Business rules: Create once, verify identical on subsequent runs as an idempotent no-op, otherwise preserve existing files byte-for-byte and fail closed.
 * Execution flow: Inspect path safety, check existing bytes for identical match, validate unreviewed status if differing, and use atomic exclusive creation when absent.
 * Failure cases: Rejects symbolic links, non-regular files, malformed JSON, differing unreviewed content, reviewer annotations, and concurrent collisions.
 * Side effects: Writes new file exclusively on initial creation; leaves existing files untouched on identical rerun or any failure.
 */
export function safePublishReviewArtifact(
  options: SafePublishReviewArtifactOptions,
): SafePublishReviewArtifactResult {
  const {
    outputPath,
    generatedBytes,
    validateExisting = assertUnreviewedLegalCandidate,
    artifactKindLabel = "legal review artifact",
  } = options;

  const resolved = path.resolve(outputPath);
  const newBuf = Buffer.from(generatedBytes, "utf8");
  const newHash = createHash("sha256").update(newBuf).digest("hex");

  if (existsSync(resolved)) {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw Error(
        `Unsafe output path: symbolic link rejected for ${artifactKindLabel}`,
      );
    }
    if (!stat.isFile()) {
      throw Error(
        `Unsafe output path: non-regular file rejected for ${artifactKindLabel}`,
      );
    }

    const existingBuf = readFileSync(resolved);
    if (Buffer.compare(existingBuf, newBuf) === 0) {
      return {
        outcome: "IDENTICAL_NOOP",
        bytes: existingBuf,
        sha256: newHash,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(existingBuf.toString("utf8"));
    } catch {
      throw Error(
        `Existing ${artifactKindLabel} is malformed JSON; refusing to overwrite existing evidence`,
      );
    }

    if (validateExisting) {
      validateExisting(parsed);
    }

    throw Error(
      `Existing ${artifactKindLabel} differs from generated content; refusing to overwrite existing evidence`,
    );
  }

  mkdirSync(path.dirname(resolved), { recursive: true });

  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`,
  );

  try {
    writeFileSync(tempPath, newBuf);
    try {
      linkSync(tempPath, resolved);
      return {
        outcome: "CREATED",
        bytes: newBuf,
        sha256: newHash,
      };
    } catch (linkErr: unknown) {
      if (
        linkErr &&
        typeof linkErr === "object" &&
        (linkErr as { code?: string }).code === "EEXIST"
      ) {
        const existingBuf = readFileSync(resolved);
        if (Buffer.compare(existingBuf, newBuf) === 0) {
          return {
            outcome: "IDENTICAL_NOOP",
            bytes: existingBuf,
            sha256: newHash,
          };
        }
        throw Error(
          `Concurrent modification detected: existing ${artifactKindLabel} differs from generated content; refusing to overwrite`,
          { cause: linkErr },
        );
      }
      // Fallback for filesystems where linkSync is not supported
      try {
        writeFileSync(resolved, newBuf, { flag: "wx" });
        return {
          outcome: "CREATED",
          bytes: newBuf,
          sha256: newHash,
        };
      } catch (wxErr: unknown) {
        if (
          wxErr &&
          typeof wxErr === "object" &&
          (wxErr as { code?: string }).code === "EEXIST"
        ) {
          const existingBuf = readFileSync(resolved);
          if (Buffer.compare(existingBuf, newBuf) === 0) {
            return {
              outcome: "IDENTICAL_NOOP",
              bytes: existingBuf,
              sha256: newHash,
            };
          }
          throw Error(
            `Concurrent modification detected: existing ${artifactKindLabel} differs from generated content; refusing to overwrite`,
            { cause: wxErr },
          );
        }
        throw wxErr;
      }
    }
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignored: best-effort temp file cleanup
    }
  }
}
