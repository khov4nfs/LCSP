import {
  computeRepositoryProfileDigest,
  PRE_SCAN_DEPENDENCY_KINDS,
  PRE_SCAN_FRAMEWORK_CATEGORIES,
  PRE_SCAN_GAP_REASONS,
  REPOSITORY_MANIFEST_TYPES,
  REPOSITORY_SCANNER_VERSIONS,
  repositoryProfileSchema,
  type RepositoryProfile,
} from "../src/assessment-domain/repository-profile.ts";

describe("RepositoryProfile contract", () => {
  const validProfileInput: RepositoryProfile = {
    repositoryId: "repo-123",
    commitSha: "132b5d796b32bf2f4454990b64df7d0435e28161",
    sourcePathPrefix: "packages/backend",
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    contentDigest:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    languages: [
      {
        language: "TypeScript",
        fileCount: 42,
        samplePaths: ["packages/backend/src/index.ts"],
      },
    ],
    manifests: [
      {
        path: "packages/backend/package.json",
        startLine: 1,
        endLine: 35,
        manifestType: REPOSITORY_MANIFEST_TYPES.packageJson,
        name: "@example/backend",
        version: "1.0.0",
        dependencies: [
          {
            name: "express",
            versionRange: "^4.18.2",
            kind: PRE_SCAN_DEPENDENCY_KINDS.production,
            line: 15,
          },
        ],
      },
    ],
    frameworks: [
      {
        name: "Express",
        category: PRE_SCAN_FRAMEWORK_CATEGORIES.webFramework,
        path: "packages/backend/package.json",
        line: 15,
        evidenceExcerpt: '"express": "^4.18.2"',
      },
    ],
    buildSystems: [
      {
        name: "pnpm",
        path: "pnpm-workspace.yaml",
        line: 1,
      },
    ],
    ciWorkflows: [
      {
        name: "CI",
        path: ".github/workflows/ci.yml",
        line: 1,
      },
    ],
    containerization: [
      {
        kind: "DOCKERFILE",
        path: "Dockerfile",
        line: 1,
      },
    ],
    candidateFacts: [
      {
        statement:
          "Repository defines an Express web framework dependency (packages/backend/package.json:15)",
        kind: "FACT",
        authority: "EVIDENCE_CITED",
        evidence: {
          path: "packages/backend/package.json",
          startLine: 15,
          endLine: 15,
          excerptSha256:
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
    ],
    knownGaps: [
      {
        path: "large-bundle.min.js",
        reason: PRE_SCAN_GAP_REASONS.fileSizeLimitExceeded,
        detail: "Exceeded 2MB limit",
      },
    ],
    scannedFileCount: 45,
    scannedAt: "2026-11-13T23:30:00.000Z",
  };

  it("validates a compliant repository profile", () => {
    const result = repositoryProfileSchema.safeParse(validProfileInput);
    expect(result.success).toBe(true);
  });

  it("computes a deterministic content digest", () => {
    const digest1 = computeRepositoryProfileDigest(validProfileInput);
    const digest2 = computeRepositoryProfileDigest(validProfileInput);
    expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digest1).toBe(digest2);
  });

  it("rejects path traversal in manifest path", () => {
    const invalid = {
      ...validProfileInput,
      manifests: [
        {
          ...validProfileInput.manifests[0],
          path: "../escape/package.json",
        },
      ],
    };
    const result = repositoryProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid commit SHA format", () => {
    const invalid = {
      ...validProfileInput,
      commitSha: "invalid-sha-123",
    };
    const result = repositoryProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid scanner version", () => {
    const invalid = {
      ...validProfileInput,
      scannerVersion: "UNKNOWN_VERSION",
    };
    const result = repositoryProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
