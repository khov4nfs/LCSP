/**
 * Summarizes file access observations and indexes accepted source evidence for session export.
 */

/**
 * Business purpose: Summarize file access observations and index source evidence from accepted evidence records.
 * Business rules: Only unique file paths are indexed; whole-file digests remain null until independently verified.
 * Execution flow:
 * 1. Extract file paths and repository citations from evidence records.
 * 2. Deduplicate examined file paths.
 * 3. Construct the source evidence index with citation line ranges and excerpt digests.
 * Failure cases: Empty or missing evidence list returns zero unique files and empty indices.
 * Side effects: Pure reduction; no database updates or side effects.
 */
export function summarizeSessionFileEvidence(evidenceList: any[]) {
  if (!evidenceList || evidenceList.length === 0) {
    return {
      observedUniqueFilesExamined: 0,
      fileAccessObservations: { files: [] },
      sourceEvidenceIndex: [],
    };
  }

  const uniquePaths = new Set<string>();
  const sourceEvidenceIndex: any[] = [];

  for (const item of evidenceList) {
    const payload = item.payload ?? item;
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
    observedUniqueFilesExamined: uniquePaths.size,
    fileAccessObservations: { files },
    sourceEvidenceIndex,
  };
}
