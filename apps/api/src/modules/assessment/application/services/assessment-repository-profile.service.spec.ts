import { jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  computeRepositoryProfileDigest,
  PRE_SCAN_DEPENDENCY_KINDS,
  PRE_SCAN_FRAMEWORK_CATEGORIES,
  REPOSITORY_MANIFEST_TYPES,
  REPOSITORY_SCANNER_VERSIONS,
  type RepositoryProfile,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentRepositoryProfileService } from "./assessment-repository-profile.service.js";

type MockPrismaSnapshot = {
  findUnique: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
};

type MockCaseSupport = {
  loadPins: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
};

describe("AssessmentRepositoryProfileService", () => {
  let service: AssessmentRepositoryProfileService;
  let mockSnapshot: MockPrismaSnapshot;
  let mockSupport: MockCaseSupport;

  const validProfileBase: Omit<
    RepositoryProfile,
    "contentDigest" | "scannedAt"
  > = {
    repositoryId: "repo-123",
    commitSha: "132b5d796b32bf2f4454990b64df7d0435e28161",
    sourcePathPrefix: "packages/api",
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    languages: [
      {
        language: "TypeScript",
        fileCount: 10,
        samplePaths: ["packages/api/src/main.ts"],
      },
    ],
    manifests: [
      {
        path: "packages/api/package.json",
        startLine: 1,
        endLine: 25,
        manifestType: REPOSITORY_MANIFEST_TYPES.packageJson,
        name: "@example/api",
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
        path: "packages/api/package.json",
        line: 15,
        evidenceExcerpt: '"express": "^4.18.2"',
      },
    ],
    buildSystems: [],
    ciWorkflows: [],
    containerization: [],
    candidateFacts: [],
    knownGaps: [],
    scannedFileCount: 12,
  };

  const validProfile: RepositoryProfile = {
    ...validProfileBase,
    contentDigest: computeRepositoryProfileDigest(validProfileBase),
    scannedAt: "2026-11-13T23:45:00.000Z",
  };

  beforeEach(() => {
    mockSnapshot = {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        repositoryId: "repo-123",
      }),
    };
    mockSupport = {
      loadPins: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        repositorySnapshotId: "snapshot-456",
        repositoryCommit: "132b5d796b32bf2f4454990b64df7d0435e28161",
        sourcePathPrefix: "packages/api",
      }),
    };
    const mockPrisma = {
      repositorySnapshot: mockSnapshot,
    };
    service = new AssessmentRepositoryProfileService(
      mockPrisma as never,
      mockSupport as never,
    );
  });

  const getMockTx = (): Prisma.TransactionClient =>
    ({
      repositorySnapshot: mockSnapshot,
    }) as unknown as Prisma.TransactionClient;

  describe("buildCacheKey", () => {
    it("normalizes commit to lowercase and formats composite key", () => {
      const key = service.buildCacheKey(
        "repo-1",
        "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
        "src/sub",
        REPOSITORY_SCANNER_VERSIONS.v1,
      );
      expect(key).toBe(
        "repo-1:abcdef1234567890abcdef1234567890abcdef12:src/sub:LCSP_PRE_SCAN_V1",
      );
    });

    it("uses ROOT when sourcePathPrefix is null", () => {
      const key = service.buildCacheKey("repo-1", "abc", null);
      expect(key).toBe("repo-1:abc:ROOT:LCSP_PRE_SCAN_V1");
    });
  });

  describe("saveProfileInTx", () => {
    it("successfully saves a verified profile and populates cache", async () => {
      const mockTx = getMockTx();
      const result = await service.saveProfileInTx(mockTx, {
        assessmentId: "assessment-1",
        correlationId: "corr-1",
        profile: validProfile,
      });

      expect(result.ok).toBe(true);
      expect(result.contentDigest).toBe(validProfile.contentDigest);

      const cached = await service.getProfileInTx(mockTx, {
        assessmentId: "assessment-1",
        correlationId: "corr-1",
      });
      expect(cached).toEqual(validProfile);
    });

    it("rejects when content digest does not match", async () => {
      const mockTx = getMockTx();
      const tampered = {
        ...validProfile,
        contentDigest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };

      await expect(
        service.saveProfileInTx(mockTx, {
          assessmentId: "assessment-1",
          correlationId: "corr-1",
          profile: tampered,
        }),
      ).rejects.toThrow();
    });

    it("rejects when commit SHA does not match pinned snapshot", async () => {
      const mockTx = getMockTx();
      mockSupport.loadPins.mockResolvedValueOnce({
        repositorySnapshotId: "snapshot-456",
        repositoryCommit: "0000000000000000000000000000000000000000",
        sourcePathPrefix: "packages/api",
      });

      await expect(
        service.saveProfileInTx(mockTx, {
          assessmentId: "assessment-1",
          correlationId: "corr-1",
          profile: validProfile,
        }),
      ).rejects.toThrow();
    });

    it("rejects when source path prefix does not match pinned snapshot", async () => {
      const mockTx = getMockTx();
      mockSupport.loadPins.mockResolvedValueOnce({
        repositorySnapshotId: "snapshot-456",
        repositoryCommit: "132b5d796b32bf2f4454990b64df7d0435e28161",
        sourcePathPrefix: "packages/other",
      });

      await expect(
        service.saveProfileInTx(mockTx, {
          assessmentId: "assessment-1",
          correlationId: "corr-1",
          profile: validProfile,
        }),
      ).rejects.toThrow();
    });
  });

  describe("invalidateCache", () => {
    it("invalidates cache entries by repositoryId or commitSha", async () => {
      const mockTx = getMockTx();
      await service.saveProfileInTx(mockTx, {
        assessmentId: "assessment-1",
        correlationId: "corr-1",
        profile: validProfile,
      });

      const evicted = service.invalidateCache({ repositoryId: "repo-123" });
      expect(evicted).toBe(1);

      const cached = await service.getProfileInTx(mockTx, {
        assessmentId: "assessment-1",
        correlationId: "corr-1",
      });
      expect(cached).toBeNull();
    });
  });
});
