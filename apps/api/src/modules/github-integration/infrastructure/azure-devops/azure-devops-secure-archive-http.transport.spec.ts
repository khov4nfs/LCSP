import { describe, expect, it, jest } from "@jest/globals";
import { createHash } from "node:crypto";
import {
  encodeAzureDevOpsOrganizationPatCredential,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";
import { CredentialLease } from "../../application/security/credential-lease.js";
import { AzureDevOpsSecureArchiveHttpTransport } from "./azure-devops-secure-archive-http.transport.js";

const PAT = "azure-archive-pat";
const SHA = "a".repeat(40);
const REPOSITORY_ID = "12345678-1234-4234-8234-123456789abc";
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const REPOSITORY = {
  id: REPOSITORY_ID,
  name: "Repo",
  project: { name: "Project Space" },
};
const TREE_ID = "b".repeat(40);

function treeResponse(entries: Array<Record<string, unknown>>) {
  return jsonResponse({ objectId: TREE_ID, treeEntries: entries });
}

function treePathDigest(paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths
    .map((item) => Buffer.from(item, "utf8"))
    .sort((left, right) => Buffer.compare(left, right))) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(path.length);
    hash.update(length).update(path);
  }
  return hash.digest("hex");
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function credential() {
  return new CredentialLease(
    encodeAzureDevOpsOrganizationPatCredential({
      organization: "fabrikam",
      pat: PAT,
    }),
    {
      internalCredentialId: "credential-1",
      credentialVersion: 1,
      repositoryFullName: "fabrikam/Project Space/Repo",
      expiresAt: new Date(Date.now() + 60_000),
    },
  );
}

async function streamBytes(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("AzureDevOpsSecureArchiveHttpTransport", () => {
  it("requests a ZIP for the exact repository GUID and commit without following redirects", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REPOSITORY))
      .mockResolvedValueOnce(jsonResponse({ commitId: SHA, treeId: TREE_ID }))
      .mockResolvedValueOnce(
        treeResponse([
          {
            objectId: "c".repeat(40),
            relativePath: "README.md",
            mode: "100644",
            gitObjectType: "blob",
          },
          {
            objectId: "d".repeat(40),
            relativePath: "src/main.py",
            mode: "100755",
            gitObjectType: "blob",
          },
          {
            objectId: "e".repeat(40),
            relativePath: "src",
            mode: "40000",
            gitObjectType: "tree",
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(ZIP, {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      );
    const transport = new AzureDevOpsSecureArchiveHttpTransport({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const lease = credential();
    try {
      const archive = await transport.downloadArchive({
        credentialLease: lease,
        repositoryId: REPOSITORY_ID,
        repositoryFullName: "fabrikam/Project Space/Repo",
        commitSha: SHA,
      });
      expect(await streamBytes(archive.stream)).toEqual(ZIP);
      const [request, init] = fetchImpl.mock.calls[3];
      const url = new URL(requestUrl(request));
      expect(url.hostname).toBe("dev.azure.com");
      expect(url.pathname).toContain(`/${REPOSITORY_ID}/items`);
      expect(url.searchParams.get("versionDescriptor.version")).toBe(SHA);
      expect(url.searchParams.get("versionDescriptor.versionType")).toBe(
        "commit",
      );
      expect(url.searchParams.get("$format")).toBe("zip");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`,
      );
      expect(init?.redirect).toBe("manual");
      expect(archive.archiveRoot).toBeUndefined();
      expect(archive.treeManifest).toEqual({
        version: 1,
        commitSha: SHA,
        treeId: TREE_ID,
        fileCount: 2,
        pathSha256: treePathDigest(["README.md", "src/main.py"]),
      });
      const treeRequest = new URL(requestUrl(fetchImpl.mock.calls[2][0]));
      expect(treeRequest.pathname).toContain(`/trees/${TREE_ID}`);
      expect(treeRequest.searchParams.get("recursive")).toBe("true");
    } finally {
      lease.dispose();
    }
  });

  it("walks the pinned tree with bounded requests when Azure marks the recursive tree truncated", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REPOSITORY))
      .mockResolvedValueOnce(jsonResponse({ commitId: SHA, treeId: TREE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({
          objectId: TREE_ID,
          truncated: true,
          treeEntries: [],
        }),
      )
      .mockResolvedValueOnce(
        treeResponse([
          {
            objectId: "c".repeat(40),
            relativePath: "src",
            mode: "40000",
            gitObjectType: "tree",
          },
          {
            objectId: "d".repeat(40),
            relativePath: "README.md",
            mode: "100644",
            gitObjectType: "blob",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          objectId: "c".repeat(40),
          treeEntries: [
            {
              objectId: "e".repeat(40),
              relativePath: "main.py",
              mode: "100755",
              gitObjectType: "blob",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(ZIP, {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      );
    const transport = new AzureDevOpsSecureArchiveHttpTransport({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const lease = credential();
    try {
      const archive = await transport.downloadArchive({
        credentialLease: lease,
        repositoryId: REPOSITORY_ID,
        repositoryFullName: "fabrikam/Project Space/Repo",
        commitSha: SHA,
      });
      expect(archive.treeManifest).toEqual({
        version: 1,
        commitSha: SHA,
        treeId: TREE_ID,
        fileCount: 2,
        pathSha256: treePathDigest(["README.md", "src/main.py"]),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(6);
      const boundedRootRequest = new URL(
        requestUrl(fetchImpl.mock.calls[3][0]),
      );
      expect(boundedRootRequest.searchParams.has("recursive")).toBe(false);
    } finally {
      lease.dispose();
    }
  });

  it("fails closed when bounded tree traversal still reports incomplete metadata", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REPOSITORY))
      .mockResolvedValueOnce(jsonResponse({ commitId: SHA, treeId: TREE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ objectId: TREE_ID, truncated: true, treeEntries: [] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ objectId: TREE_ID, truncated: true, treeEntries: [] }),
      );
    const transport = new AzureDevOpsSecureArchiveHttpTransport({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const lease = credential();
    try {
      await expect(
        transport.downloadArchive({
          credentialLease: lease,
          repositoryId: REPOSITORY_ID,
          repositoryFullName: "fabrikam/Project Space/Repo",
          commitSha: SHA,
        }),
      ).rejects.toMatchObject({
        code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      lease.dispose();
    }
  });

  it("rejects redirects and non-ZIP login bodies", async () => {
    const redirectFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REPOSITORY))
      .mockResolvedValueOnce(jsonResponse({ commitId: SHA, treeId: TREE_ID }))
      .mockResolvedValueOnce(
        treeResponse([
          {
            objectId: "c".repeat(40),
            relativePath: "file.txt",
            mode: "100644",
            gitObjectType: "blob",
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/archive.zip" },
        }),
      );
    const redirectTransport = new AzureDevOpsSecureArchiveHttpTransport({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl: redirectFetch,
    });
    const firstLease = credential();
    try {
      await expect(
        redirectTransport.downloadArchive({
          credentialLease: firstLease,
          repositoryId: REPOSITORY_ID,
          repositoryFullName: "fabrikam/Project Space/Repo",
          commitSha: SHA,
        }),
      ).rejects.toMatchObject({
        code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      firstLease.dispose();
    }

    const htmlFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REPOSITORY))
      .mockResolvedValueOnce(jsonResponse({ commitId: SHA, treeId: TREE_ID }))
      .mockResolvedValueOnce(
        treeResponse([
          {
            objectId: "c".repeat(40),
            relativePath: "file.txt",
            mode: "100644",
            gitObjectType: "blob",
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response("<html>sign in</html>", {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      );
    const htmlTransport = new AzureDevOpsSecureArchiveHttpTransport({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl: htmlFetch,
    });
    const secondLease = credential();
    try {
      const archive = await htmlTransport.downloadArchive({
        credentialLease: secondLease,
        repositoryId: REPOSITORY_ID,
        repositoryFullName: "fabrikam/Project Space/Repo",
        commitSha: SHA,
      });
      await expect(streamBytes(archive.stream)).rejects.toMatchObject({
        code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      secondLease.dispose();
    }
  });
});
