import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { finished } from "node:stream/promises";

import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_DIRECTORY_NAME = "lcsp-snapshot-archive-cache";

export type SnapshotArchiveCacheLookup = {
  snapshotId: string;
  commitSha: string;
};

export type SnapshotArchiveCacheHit = {
  contentType: string;
  resolvedUrl: string;
  stream: NodeJS.ReadableStream;
};

export type SnapshotArchiveCacheCaptureInput = SnapshotArchiveCacheLookup & {
  contentType: string;
  resolvedUrl: string;
  source: NodeJS.ReadableStream;
};

export type SnapshotArchiveCacheCapture = {
  stream: NodeJS.ReadableStream;
  completion: Promise<void>;
};

type SnapshotArchiveCacheMetadata = SnapshotArchiveCacheLookup & {
  contentType: string;
  resolvedUrl: string;
  expiresAt: number;
};

/**
 * Keeps pinned repository archives in process-local temporary storage for a short TTL.
 *
 * Raw source never enters Prisma or durable object storage. Cache entries are bound to
 * both snapshot ID and immutable commit SHA, removed on expiry, and deleted on graceful
 * API shutdown. HTTP responses remain `no-store`; this cache is only an internal rerun
 * optimization that avoids repeated GitHub archive downloads for the same pinned source.
 */
@Injectable()
export class SnapshotArchiveCache implements OnModuleInit, OnModuleDestroy {
  private readonly rootDirectory =
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR?.trim() ||
    join(tmpdir(), CACHE_DIRECTORY_NAME);
  private readonly ttlMs = readCacheTtlMs();
  private readonly evictionTimers = new Map<string, NodeJS.Timeout>();

  /** Initializes the private temporary directory and restores expiry cleanup for surviving entries. */
  async onModuleInit(): Promise<void> {
    await this.ensureRootDirectory();
    await this.restoreEvictionTimers();
  }

  /** Clears timers and removes all ephemeral raw-source cache files on graceful shutdown. */
  async onModuleDestroy(): Promise<void> {
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    await rm(this.rootDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  /**
   * Opens a valid cached archive for the exact pinned snapshot and commit.
   *
   * @param lookup - Immutable snapshot and commit identity.
   * @returns Cached stream metadata, or null when the entry is absent, expired, or invalid.
   */
  async get(
    lookup: SnapshotArchiveCacheLookup,
  ): Promise<SnapshotArchiveCacheHit | null> {
    await this.ensureRootDirectory();
    const key = cacheKey(lookup);
    const paths = this.pathsForKey(key);

    try {
      const metadata = parseMetadata(await readFile(paths.metadata, "utf8"));
      if (
        !metadata ||
        metadata.snapshotId !== lookup.snapshotId ||
        metadata.commitSha !== lookup.commitSha ||
        cacheKey(metadata) !== key ||
        metadata.expiresAt <= Date.now()
      ) {
        await this.removeEntry(key);
        return null;
      }

      await access(paths.archive);
      this.scheduleEviction(key, metadata.expiresAt - Date.now());
      return {
        contentType: metadata.contentType,
        resolvedUrl: metadata.resolvedUrl,
        stream: createReadStream(paths.archive),
      };
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        await this.removeEntry(key);
      }
      return null;
    }
  }

  /**
   * Mirrors a GitHub archive stream into a private temporary file while preserving streaming to the worker.
   * Cache write failures are represented by the completion promise and do not corrupt the downstream stream.
   *
   * @param input - Pinned identity, archive metadata, and source stream.
   * @returns Downstream stream plus asynchronous cache commit completion.
   */
  async capture(
    input: SnapshotArchiveCacheCaptureInput,
  ): Promise<SnapshotArchiveCacheCapture> {
    await this.ensureRootDirectory();
    const key = cacheKey(input);
    const paths = this.pathsForKey(key);
    const temporaryArchive = `${paths.archive}.${randomUUID()}.tmp`;
    const writer = createWriteStream(temporaryArchive, { mode: 0o600 });
    const tee = new ArchiveCacheTee(writer);
    const source = input.source as Readable;

    const sourceErrorHandler = (error: Error): void => {
      tee.destroy(error);
    };
    source.once("error", sourceErrorHandler);
    source.pipe(tee);

    const completion = finished(tee)
      .then(async () => {
        source.off("error", sourceErrorHandler);
        if (!tee.cacheSucceeded) {
          throw new Error("snapshot_archive_cache_write_failed");
        }

        await rename(temporaryArchive, paths.archive);
        const metadata: SnapshotArchiveCacheMetadata = {
          snapshotId: input.snapshotId,
          commitSha: input.commitSha,
          contentType: input.contentType,
          resolvedUrl: input.resolvedUrl,
          expiresAt: Date.now() + this.ttlMs,
        };
        const temporaryMetadata = `${paths.metadata}.${randomUUID()}.tmp`;
        await writeFile(temporaryMetadata, JSON.stringify(metadata), {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporaryMetadata, paths.metadata);
        this.scheduleEviction(key, this.ttlMs);
      })
      .catch(async (error: unknown) => {
        source.off("error", sourceErrorHandler);
        await rm(temporaryArchive, { force: true }).catch(() => undefined);
        await this.removeEntry(key);
        throw error;
      });

    return { stream: tee, completion };
  }

  private async ensureRootDirectory(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  private pathsForKey(key: string): { archive: string; metadata: string } {
    return {
      archive: join(this.rootDirectory, `${key}.archive`),
      metadata: join(this.rootDirectory, `${key}.json`),
    };
  }

  private scheduleEviction(key: string, delayMs: number): void {
    const previous = this.evictionTimers.get(key);
    if (previous) {
      clearTimeout(previous);
    }

    const timer = setTimeout(
      () => {
        void this.removeEntry(key);
      },
      Math.max(0, delayMs),
    );
    timer.unref();
    this.evictionTimers.set(key, timer);
  }

  private async removeEntry(key: string): Promise<void> {
    const timer = this.evictionTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(key);
    }
    const paths = this.pathsForKey(key);
    await Promise.allSettled([
      rm(paths.archive, { force: true }),
      rm(paths.metadata, { force: true }),
    ]);
  }

  private async restoreEvictionTimers(): Promise<void> {
    const entries = await readdir(this.rootDirectory).catch(
      () => [] as string[],
    );
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) {
        await rm(join(this.rootDirectory, entry), { force: true }).catch(
          () => undefined,
        );
        continue;
      }
      if (!entry.endsWith(".json")) {
        continue;
      }

      const key = entry.slice(0, -".json".length);
      const paths = this.pathsForKey(key);
      const metadata = await readFile(paths.metadata, "utf8")
        .then(parseMetadata)
        .catch(() => null);
      if (
        !metadata ||
        cacheKey(metadata) !== key ||
        metadata.expiresAt <= Date.now()
      ) {
        await this.removeEntry(key);
        continue;
      }
      this.scheduleEviction(key, metadata.expiresAt - Date.now());
    }
  }
}

class ArchiveCacheTee extends Transform {
  private writerFailed = false;

  constructor(private readonly writer: WriteStream) {
    super();
    this.writer.on("error", () => {
      this.writerFailed = true;
    });
  }

  get cacheSucceeded(): boolean {
    return !this.writerFailed && this.writer.writableFinished;
  }

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.push(chunk, encoding);
    if (this.writerFailed || this.writer.destroyed) {
      callback();
      return;
    }

    if (this.writer.write(chunk, encoding)) {
      callback();
      return;
    }

    const resume = (): void => {
      this.writer.off("drain", resume);
      this.writer.off("error", resume);
      callback();
    };
    this.writer.once("drain", resume);
    this.writer.once("error", resume);
  }

  override _flush(callback: TransformCallback): void {
    if (this.writerFailed || this.writer.destroyed) {
      callback();
      return;
    }

    const finish = (): void => {
      this.writer.off("finish", finish);
      this.writer.off("error", finish);
      callback();
    };
    this.writer.once("finish", finish);
    this.writer.once("error", finish);
    this.writer.end();
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.writer.destroyed && !this.writer.writableFinished) {
      this.writer.destroy();
    }
    callback(error);
  }
}

function cacheKey(lookup: SnapshotArchiveCacheLookup): string {
  return createHash("sha256")
    .update(`${lookup.snapshotId}:${lookup.commitSha}`)
    .digest("hex");
}

function parseMetadata(value: string): SnapshotArchiveCacheMetadata | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.snapshotId !== "string" ||
      typeof parsed.commitSha !== "string" ||
      typeof parsed.contentType !== "string" ||
      typeof parsed.resolvedUrl !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }
    return parsed as SnapshotArchiveCacheMetadata;
  } catch {
    return null;
  }
}

function readCacheTtlMs(): number {
  const raw = process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_TTL_SECONDS;
  const seconds = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CACHE_TTL_MS;
  }
  return Math.min(seconds * 1000, MAX_CACHE_TTL_MS);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
