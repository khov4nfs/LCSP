import { afterEach, describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { SnapshotArchiveCache } from "./snapshot-archive-cache.js";

let cache: SnapshotArchiveCache | null = null;
const originalCacheDirectory = process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR;
const originalCacheTtl = process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_TTL_SECONDS;

afterEach(async () => {
  if (cache) {
    await cache.onModuleDestroy();
    cache = null;
  }

  if (originalCacheDirectory === undefined) {
    delete process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR;
  } else {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = originalCacheDirectory;
  }
  if (originalCacheTtl === undefined) {
    delete process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_TTL_SECONDS;
  } else {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_TTL_SECONDS = originalCacheTtl;
  }
});

describe("SnapshotArchiveCache", () => {
  it("does not let one instance shutdown erase another instance's published archive", async () => {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-shared-"),
    );
    const first = new SnapshotArchiveCache();
    const second = new SnapshotArchiveCache();
    cache = second;
    await first.onModuleInit();
    await second.onModuleInit();
    const input = { snapshotId: "shared-snapshot", commitSha: "a".repeat(40) };
    const capture = await second.capture({
      ...input,
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/repo/tar.gz/a",
      source: Readable.from([Buffer.from("second-instance-archive")]),
    });
    await readStream(capture.stream);
    await capture.completion;

    // Why: Shutdown cleanup must only delete files owned by the stopping
    // instance; an active peer still needs its exact pinned archive.
    await first.onModuleDestroy();
    const hit = await second.get(input);
    expect(hit).not.toBeNull();
    expect(await readStream(hit!.stream)).toEqual(
      Buffer.from("second-instance-archive"),
    );
  });

  it("keeps a valid archive when a later capture of the same key fails", async () => {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-race-"),
    );
    cache = new SnapshotArchiveCache();
    await cache.onModuleInit();
    const input = { snapshotId: "same-key", commitSha: "b".repeat(40) };
    const successful = await cache.capture({
      ...input,
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/repo/tar.gz/b",
      source: Readable.from([Buffer.from("valid-archive")]),
    });
    await readStream(successful.stream);
    await successful.completion;

    // Why: A failed second attempt owns only its temporary file. Removing the
    // canonical key would destroy an already committed entry from another attempt.
    const failing = await cache.capture({
      ...input,
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/repo/tar.gz/b",
      source: new Readable({
        read() {
          this.destroy(new Error("provider stream failed"));
        },
      }),
    });
    await expect(failing.completion).rejects.toThrow("provider stream failed");
    const hit = await cache.get(input);
    expect(hit).not.toBeNull();
    expect(await readStream(hit!.stream)).toEqual(Buffer.from("valid-archive"));
  });

  it("reuses bytes only for the exact snapshot and commit identity", async () => {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-test-"),
    );
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_TTL_SECONDS = "60";
    cache = new SnapshotArchiveCache();
    await cache.onModuleInit();

    const capture = await cache.capture({
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/repo/tar.gz/a",
      archiveRoot: "trusted-root",
      source: Readable.from([Buffer.from("pinned-archive")]),
    });

    expect(await readStream(capture.stream)).toEqual(
      Buffer.from("pinned-archive"),
    );
    await capture.completion;

    const hit = await cache.get({
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
    });
    expect(hit).not.toBeNull();
    expect(hit?.archiveRoot).toBe("trusted-root");
    expect(await readStream(hit!.stream)).toEqual(
      Buffer.from("pinned-archive"),
    );

    await expect(
      cache.get({
        snapshotId: "snapshot-1",
        commitSha: "b".repeat(40),
      }),
    ).resolves.toBeNull();
  });

  it("removes ephemeral raw-source files on graceful shutdown", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-test-"),
    );
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = directory;
    cache = new SnapshotArchiveCache();
    await cache.onModuleInit();

    const capture = await cache.capture({
      snapshotId: "snapshot-2",
      commitSha: "c".repeat(40),
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/repo/tar.gz/c",
      archiveRoot: null,
      source: Readable.from([Buffer.from("ephemeral-source")]),
    });
    await readStream(capture.stream);
    await capture.completion;
    await cache.onModuleDestroy();
    cache = null;

    const probe = new SnapshotArchiveCache();
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = directory;
    cache = probe;
    await probe.onModuleInit();
    await expect(
      probe.get({
        snapshotId: "snapshot-2",
        commitSha: "c".repeat(40),
      }),
    ).resolves.toBeNull();
  });

  it("preserves missing legacy root metadata as unknown instead of rootless", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-test-"),
    );
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = directory;
    cache = new SnapshotArchiveCache();
    await cache.onModuleInit();

    const snapshotId = "snapshot-unknown-root";
    const commitSha = "d".repeat(40);
    const capture = await cache.capture({
      snapshotId,
      commitSha,
      contentType: "application/zip",
      resolvedUrl: "https://bitbucket.org/workspace/repository/get/pinned.zip",
      archiveRoot: null,
      source: Readable.from([Buffer.from("pinned-archive")]),
    });
    await readStream(capture.stream);
    await capture.completion;

    const key = createHash("sha256")
      .update(`${snapshotId}:${commitSha}`)
      .digest("hex");
    const [instanceDirectory] = await readdir(directory);
    const metadataPath = join(directory, instanceDirectory, `${key}.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete metadata.archiveRoot;
    await writeFile(metadataPath, JSON.stringify(metadata));

    const hit = await cache.get({ snapshotId, commitSha });
    expect(hit).not.toBeNull();
    expect(hit?.archiveRoot).toBeUndefined();
    await readStream(hit!.stream);
  });

  it("preserves the pinned tree path manifest for an unknown-root Azure ZIP", async () => {
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = await mkdtemp(
      join(tmpdir(), "lcsp-snapshot-cache-test-"),
    );
    cache = new SnapshotArchiveCache();
    await cache.onModuleInit();
    const treeManifest = {
      version: 1 as const,
      commitSha: "e".repeat(40),
      treeId: "f".repeat(40),
      fileCount: 2,
      pathSha256: "a".repeat(64),
    };
    const capture = await cache.capture({
      snapshotId: "snapshot-azure-tree",
      commitSha: treeManifest.commitSha,
      contentType: "application/zip",
      resolvedUrl: "https://dev.azure.com/",
      treeManifest,
      source: Readable.from([Buffer.from("pinned-azure-zip")]),
    });
    await readStream(capture.stream);
    await capture.completion;

    const hit = await cache.get({
      snapshotId: "snapshot-azure-tree",
      commitSha: treeManifest.commitSha,
    });
    expect(hit?.archiveRoot).toBeUndefined();
    expect(hit?.treeManifest).toEqual(treeManifest);
    await readStream(hit!.stream);
  });
});

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
