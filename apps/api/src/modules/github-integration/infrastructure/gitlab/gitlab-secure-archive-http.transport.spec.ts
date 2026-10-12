/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it, jest } from "@jest/globals";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { GitLabSecureArchiveHttpTransport } from "./gitlab-secure-archive-http.transport.js";

describe("GitLabSecureArchiveHttpTransport", () => {
  it("requests the numeric project archive with the exact SHA", async () => {
    const sha = "a".repeat(40);
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(Buffer.from("archive"), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    );
    const lease = new CredentialLease("gitlab-token", {
      internalCredentialId: "credential",
      credentialVersion: 1,
      repositoryFullName: "group/project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      const result = await new GitLabSecureArchiveHttpTransport(
        { timeoutMs: 5_000, maxArchiveBytes: 1024 },
        fetchMock,
      ).downloadArchive({
        credentialLease: lease,
        repositoryId: "85764096",
        repositoryFullName: "group/project",
        commitSha: sha,
      });
      let bytes = 0;
      for await (const chunk of result.stream) bytes += chunk.length;
      expect(bytes).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://gitlab.com/api/v4/projects/85764096/repository/archive.tar.gz?sha=${sha}`,
        expect.objectContaining({
          method: "GET",
          mode: "same-origin",
          redirect: "manual",
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "gitlab-token",
          }),
        }),
      );
      const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(requestHeaders.has("accept")).toBe(false);
    } finally {
      lease.dispose();
    }
  });
});
