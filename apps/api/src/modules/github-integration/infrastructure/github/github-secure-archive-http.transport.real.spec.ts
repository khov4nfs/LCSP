import { describe, expect, it } from "@jest/globals";
import { Readable } from "node:stream";

import { GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { GitHubSecureArchiveHttpTransport } from "./github-secure-archive-http.transport.js";

const credential = process.env.GH_TOKEN;
const repositoryFullName = process.env.LCSP_REAL_GITHUB_ARCHIVE_REPOSITORY;
const commitSha = process.env.LCSP_REAL_GITHUB_ARCHIVE_SHA;
const enabled =
  typeof credential === "string" &&
  typeof repositoryFullName === "string" &&
  typeof commitSha === "string" &&
  /^[0-9a-f]{40}$/iu.test(commitSha);
const describeReal = enabled ? describe : describe.skip;

describeReal(
  "GitHub secure archive HTTP transport (opt-in real GitHub)",
  () => {
    it("validates the real redirect and streams a gzip archive without exposing the PAT", async () => {
      const lease = new CredentialLease(credential!, {
        internalCredentialId: "manual-real-github-archive-test",
        credentialVersion: 1,
        repositoryFullName: repositoryFullName!,
        expiresAt: new Date(Date.now() + 120_000),
      });
      try {
        const transport = new GitHubSecureArchiveHttpTransport({
          timeoutMs: 120_000,
          maxArchiveBytes: 100 * 1024 * 1024,
        });
        const result = await transport.downloadArchive({
          credentialLease: lease,
          repositoryFullName: repositoryFullName!,
          commitSha: commitSha!,
        });
        expect(result.redirectValidation).toBe(
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        );
        const firstChunk = await readFirstChunk(result.stream);
        expect(firstChunk.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
        expect(JSON.stringify(result)).not.toContain(credential);
      } finally {
        lease.dispose();
      }
    });
  },
);

async function readFirstChunk(stream: NodeJS.ReadableStream): Promise<Buffer> {
  for await (const chunk of stream) {
    (stream as Readable).destroy();
    return Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as unknown as Uint8Array);
  }
  throw new Error("github_archive_empty");
}
