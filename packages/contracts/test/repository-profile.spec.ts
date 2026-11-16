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

  it("accepts AI dependency framework categories while retaining scanner V1", () => {
    expect(REPOSITORY_SCANNER_VERSIONS).toEqual({
      v1: "LCSP_PRE_SCAN_V1",
    });

    const profileWithAiFrameworks = {
      ...validProfileInput,
      frameworks: [
        {
          ...validProfileInput.frameworks[0],
          name: "OpenAI SDK",
          category: PRE_SCAN_FRAMEWORK_CATEGORIES.aiProviderSdk,
        },
        {
          ...validProfileInput.frameworks[0],
          name: "LangChain",
          category: PRE_SCAN_FRAMEWORK_CATEGORIES.aiOrchestration,
        },
        {
          ...validProfileInput.frameworks[0],
          name: "PyTorch",
          category: PRE_SCAN_FRAMEWORK_CATEGORIES.mlFramework,
        },
      ],
    };

    const result = repositoryProfileSchema.safeParse(profileWithAiFrameworks);
    expect(result.success).toBe(true);
  });

  it("accepts workspaceNotFound and workspaceNotDirectory gap reasons", () => {
    const profileWithWorkspaceGaps = {
      ...validProfileInput,
      knownGaps: [
        {
          path: "/workspace/repository",
          reason: PRE_SCAN_GAP_REASONS.workspaceNotFound,
          detail: "Workspace directory does not exist",
        },
        {
          path: "/workspace/repository",
          reason: PRE_SCAN_GAP_REASONS.workspaceNotDirectory,
          detail: "Workspace path is not a directory",
        },
      ],
    };
    const result = repositoryProfileSchema.safeParse(profileWithWorkspaceGaps);
    expect(result.success).toBe(true);
  });

  it("retains scanner V1 while accepting explicit collection truncation gaps", () => {
    const boundedProfile = {
      ...validProfileInput,
      knownGaps: [
        {
          path: "",
          reason: PRE_SCAN_GAP_REASONS.collectionLimitReached,
          detail:
            "Profile collection frameworks contained 501 observations; retained the first 500 and omitted 1.",
        },
      ],
    };

    expect(REPOSITORY_SCANNER_VERSIONS.v1).toBe("LCSP_PRE_SCAN_V1");
    expect(repositoryProfileSchema.safeParse(boundedProfile).success).toBe(
      true,
    );
  });
});
