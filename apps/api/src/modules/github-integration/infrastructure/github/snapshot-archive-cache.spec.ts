import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp } from "node:fs/promises";
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
});

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
