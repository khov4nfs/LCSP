import { asRecord } from "@lcsp/contracts/shared/type-guards";

type SessionSourceEvidence = {
  evidenceId: unknown;
  path: string;
  commitSha: unknown;
  lineStart: number | null;
  lineEnd: number | null;
  excerptSha256: unknown;
  sourceExcerpt: unknown;
  fileSha256: null;
};

/**
 * Summarizes file access observations and indexes accepted source evidence for session export.
 */

/**
 * Business purpose: Summarize cited source files without misrepresenting accepted evidence as complete runtime access telemetry.
 * Business rules: Only cited unique file paths are indexed; examined-file telemetry remains unavailable unless independently observed.
 * Execution flow:
 * 1. Extract file paths and repository citations from evidence records.
 * 2. Deduplicate examined file paths.
 * 3. Construct the source evidence index with citation line ranges and excerpt digests.
 * Failure cases: Empty or missing evidence list returns zero unique files and empty indices.
 * Side effects: Pure reduction; no database updates or side effects.
 */
export function summarizeSessionFileEvidence(
  evidenceList: readonly unknown[] | null | undefined,
) {
  if (!evidenceList || evidenceList.length === 0) {
    return {
      observedUniqueFilesExamined: null,
      observedUniqueFilesExaminedCoverage: "UNAVAILABLE",
      citedUniqueFilesCount: 0,
      fileAccessObservations: { coverage: "UNAVAILABLE", files: [] },
      citedFileObservations: { files: [] },
      sourceEvidenceIndex: [],
    };
  }

  const uniquePaths = new Set<string>();
  const sourceEvidenceIndex: SessionSourceEvidence[] = [];

  for (const evidence of evidenceList) {
    const item = asRecord(evidence);
    if (!item) continue;
    const payload = asRecord(item.payload) ?? item;
    const path = payload.path ?? item.path;
    const commitSha = payload.commitSha ?? item.commitSha ?? "";
    const lineStart = payload.lineStart ?? item.lineStart ?? null;
    const lineEnd = payload.lineEnd ?? item.lineEnd ?? null;
    const excerptSha256 = payload.excerptSha256 ?? item.excerptSha256 ?? null;
    const sourceExcerpt = payload.sourceExcerpt ?? item.sourceExcerpt ?? null;

    if (path && typeof path === "string") {
      uniquePaths.add(path);
      sourceEvidenceIndex.push({
        evidenceId: item.evidenceId ?? item.id ?? "",
        path,
        commitSha,
        lineStart: typeof lineStart === "number" ? lineStart : null,
        lineEnd: typeof lineEnd === "number" ? lineEnd : null,
        excerptSha256,
        sourceExcerpt,
        fileSha256: null,
      });
    }
  }

  const files = Array.from(uniquePaths).map((p) => ({ path: p }));

  return {
    // Accepted evidence proves citation, not every file the runtime read/searched.
    observedUniqueFilesExamined: null,
    observedUniqueFilesExaminedCoverage: "UNAVAILABLE",
    citedUniqueFilesCount: uniquePaths.size,
    fileAccessObservations: { coverage: "UNAVAILABLE", files: [] },
    citedFileObservations: { files },
    sourceEvidenceIndex,
  };
}
