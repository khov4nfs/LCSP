import { describe, expect, it } from "@jest/globals";
import { summarizeSessionFileEvidence } from "./assessment-session-file-evidence.js";

describe("assessment-session-file-evidence", () => {
  it("returns zero files on empty evidence list", () => {
    const result = summarizeSessionFileEvidence([]);
    expect(result.observedUniqueFilesExamined).toBeNull();
    expect(result.observedUniqueFilesExaminedCoverage).toBe("UNAVAILABLE");
    expect(result.citedUniqueFilesCount).toBe(0);
    expect(result.fileAccessObservations).toEqual({
      coverage: "UNAVAILABLE",
      files: [],
    });
    expect(result.sourceEvidenceIndex).toHaveLength(0);
  });

  it("extracts unique file paths and formats source evidence index", () => {
    const evidenceList = [
      {
        id: "ev-1",
        payload: {
          path: "src/main.ts",
          commitSha: "abc1234",
          lineStart: 1,
          lineEnd: 20,
          excerptSha256: "sha-1",
        },
      },
      {
        id: "ev-2",
        payload: {
          path: "src/main.ts",
          commitSha: "abc1234",
          lineStart: 30,
          lineEnd: 50,
          excerptSha256: "sha-2",
        },
      },
      {
        id: "ev-3",
        path: "package.json",
        commitSha: "abc1234",
        lineStart: 1,
        lineEnd: 10,
        excerptSha256: "sha-3",
      },
    ];

    const result = summarizeSessionFileEvidence(evidenceList);
    expect(result.observedUniqueFilesExamined).toBeNull();
    expect(result.observedUniqueFilesExaminedCoverage).toBe("UNAVAILABLE");
    expect(result.citedUniqueFilesCount).toBe(2);
    expect(result.fileAccessObservations.files).toEqual([]);
    expect(result.citedFileObservations.files).toEqual([
      { path: "src/main.ts" },
      { path: "package.json" },
    ]);
    expect(result.sourceEvidenceIndex).toHaveLength(3);
    expect(result.sourceEvidenceIndex[0].fileSha256).toBeNull();
  });
});
