import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

import { jest } from "@jest/globals";

import type { AiDiscoverySnippetRef } from "@lcsp/contracts/evidence";

import { AssessmentInterviewSnippetService } from "./assessment-interview-snippet.service.js";

function tarGzip(path: string, source: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, Math.min(Buffer.byteLength(path), 100), "utf8");
  header.write(
    source.length.toString(8).padStart(11, "0") + "\0",
    124,
    12,
    "ascii",
  );
  header[156] = "0".charCodeAt(0);
  const padding = Buffer.alloc((512 - (source.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, source, padding, Buffer.alloc(1024)]));
}

function oversizedTarGzip(path: string, claimedSize: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, Math.min(Buffer.byteLength(path), 100), "utf8");
  header.write(
    claimedSize.toString(8).padStart(11, "0") + "\0",
    124,
    12,
    "ascii",
  );
  header[156] = "0".charCodeAt(0);
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

function snippetRef(source: Buffer): AiDiscoverySnippetRef {
  return {
    snapshot_id: "snapshot-1",
    commit_sha: "abc123",
    file_path: "src/gateway.ts",
    start_line: 1,
    end_line: 7,
    evidence_hash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
  };
}

describe("AssessmentInterviewSnippetService pinned snapshot integration", () => {
  const source = Buffer.from(
    [
      'export const visible = "safe";',
      "const privateKey = `-----BEGIN PRIVATE KEY-----",
      "super-secret-private-key-material",
      "-----END PRIVATE KEY-----`;",
      'const authorization = "Bearer secret-token-value";',
      'const stillVisible = "customer-safe";',
      `const oversized = "${"x".repeat(5000)}";`,
    ].join("\n"),
    "utf8",
  );

  function harness(overrides?: { source?: Buffer; commitSha?: string }) {
    const archivedSource = overrides?.source ?? source;
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            evidencePayload: {
              ai_discovery: { findings: [{ snippet_ref: snippetRef(source) }] },
            },
          }),
        ),
      },
      repositorySnapshot: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: "snapshot-1",
            commitSha: "abc123",
          }),
        ),
      },
      repositoryScanJob: {
        findFirst: jest.fn(() => Promise.resolve({ id: "scan-1" })),
      },
    };
    const queryBus = {
      execute: jest.fn(() =>
        Promise.resolve({
          snapshotId: "snapshot-1",
          commitSha: overrides?.commitSha ?? "abc123",
          repositoryFullName: "owner/repository",
          contentType: "application/gzip",
          resolvedUrl: "https://example.invalid/archive",
          stream: Readable.from(
            tarGzip("repository-abc123/src/gateway.ts", archivedSource),
          ),
        }),
      ),
    };
    return {
      service: new AssessmentInterviewSnippetService(
        prisma as never,
        queryBus as never,
      ),
      prisma,
      queryBus,
    };
  }

  it("resolves the exact pinned file, verifies its hash, redacts secrets and enforces line/byte budgets", async () => {
    const { service, prisma, queryBus } = harness();

    const result = await service.resolve({
      assessmentId: "assessment-1",
      correlationId: "corr-1",
      evidenceReportId: "report-1",
      snippetRef: snippetRef(source),
    });

    expect(prisma.repositorySnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "snapshot-1",
          assessmentId: "assessment-1",
          commitSha: "abc123",
        },
      }),
    );
    expect(queryBus.execute).toHaveBeenCalledTimes(1);
    expect(result.snippetRef).toEqual(snippetRef(source));
    expect(result.lines.map((line) => line.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    const rendered = result.lines.map((line) => line.text).join("\n");
    expect(rendered).toContain("customer-safe");
    expect(rendered).toContain("[REDACTED]");
    expect(rendered).not.toContain("super-secret-private-key-material");
    expect(rendered).not.toContain("secret-token-value");
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(4096);
    expect(result.redacted).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("rejects archive bytes that do not match the pinned evidence hash", async () => {
    const { service } = harness({
      source: Buffer.from("changed snapshot bytes", "utf8"),
    });

    await expect(
      service.resolve({
        assessmentId: "assessment-1",
        correlationId: "corr-hash",
        evidenceReportId: "report-1",
        snippetRef: snippetRef(source),
      }),
    ).rejects.toMatchObject({
      response: { code: "INTERVIEW_SOURCE_SNIPPET_HASH_MISMATCH" },
    });
  });

  it("rejects a stream whose archive metadata is not the pinned commit", async () => {
    const { service } = harness({ commitSha: "different-commit" });

    await expect(
      service.resolve({
        assessmentId: "assessment-1",
        correlationId: "corr-commit",
        evidenceReportId: "report-1",
        snippetRef: snippetRef(source),
      }),
    ).rejects.toMatchObject({
      response: { code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE" },
    });
  });
  it("rejects a locator whose line range is not present in the governed AI finding", async () => {
    const { service } = harness();
    const forged = { ...snippetRef(source), start_line: 6, end_line: 7 };

    await expect(
      service.resolve({
        assessmentId: "assessment-1",
        correlationId: "corr-range",
        evidenceReportId: "report-1",
        snippetRef: forged,
      }),
    ).rejects.toMatchObject({
      response: { code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE" },
    });
  });

  it("fails closed for common credential-looking source lines", async () => {
    const credentialSource = Buffer.from(
      [
        'const password = "value-that-must-not-render";',
        'const token = "another-value-that-must-not-render";',
        'const headers = { "x-api-key": "key-material" };',
        'const authorization = "Basic dXNlcjpwYXNz";',
        'const AWS_SECRET_ACCESS_KEY = "aws-secret-material";',
        'const providerKey = "sk-proj-abcdefghijklmnopqrstuvwxyz";',
      ].join("\n"),
      "utf8",
    );
    const { service, prisma } = harness({ source: credentialSource });
    prisma.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
      evidencePayload: {
        ai_discovery: {
          findings: [{ snippet_ref: snippetRef(credentialSource) }],
        },
      },
    });

    const result = await service.resolve({
      assessmentId: "assessment-1",
      correlationId: "corr-secrets",
      evidenceReportId: "report-1",
      snippetRef: snippetRef(credentialSource),
    });
    const rendered = result.lines.map((line) => line.text).join("\n");
    expect(rendered).toContain("[REDACTED]");
    expect(rendered).not.toContain("value-that-must-not-render");
    expect(rendered).not.toContain("another-value-that-must-not-render");
    expect(rendered).not.toContain("key-material");
    expect(rendered).not.toContain("dXNlcjpwYXNz");
    expect(rendered).not.toContain("aws-secret-material");
    expect(rendered).not.toContain("sk-proj-");
  });

  it("aborts before decompressing an oversized non-target tar member", async () => {
    const { service, queryBus } = harness();
    queryBus.execute.mockResolvedValueOnce({
      snapshotId: "snapshot-1",
      commitSha: "abc123",
      repositoryFullName: "owner/repository",
      contentType: "application/gzip",
      resolvedUrl: "https://example.invalid/archive",
      stream: Readable.from(
        oversizedTarGzip("repository-abc123/huge.bin", 65 * 1024 * 1024),
      ),
    });

    await expect(
      service.resolve({
        assessmentId: "assessment-1",
        correlationId: "corr-archive-budget",
        evidenceReportId: "report-1",
        snippetRef: snippetRef(source),
      }),
    ).rejects.toMatchObject({
      response: { code: "INTERVIEW_SOURCE_SNIPPET_ARCHIVE_TOO_LARGE" },
    });
  });
});
