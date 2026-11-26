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
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../../../config/config.types.js";
import type { PinnedRepositoryTreeManifest } from "../../application/ports/github-archive-transport.port.js";

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
  archiveRoot?: string | null;
  treeManifest?: PinnedRepositoryTreeManifest;
  stream: Readable;
};

export type SnapshotArchiveCacheCaptureInput = SnapshotArchiveCacheLookup & {
  contentType: string;
  resolvedUrl: string;
  archiveRoot?: string | null;
  treeManifest?: PinnedRepositoryTreeManifest;
  source: NodeJS.ReadableStream;
};

export type SnapshotArchiveCacheCapture = {
  stream: NodeJS.ReadableStream;
  completion: Promise<void>;
};

type SnapshotArchiveCacheMetadata = SnapshotArchiveCacheLookup & {
  contentType: string;
  resolvedUrl: string;
  archiveRoot?: string | null;
  treeManifest?: PinnedRepositoryTreeManifest;
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
  private readonly rootDirectory: string;
  private readonly ttlMs = readCacheTtlMs();
  private readonly evictionTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig>,
  ) {
    const configuredDir = this.configService?.get("storage", {
      infer: true,
    })?.snapshotArchiveCacheDir;
    this.rootDirectory =
      configuredDir ||
      process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR?.trim() ||
      join(tmpdir(), CACHE_DIRECTORY_NAME);
  }

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
   * Business purpose: Reuse bytes only when the ephemeral cache entry matches the exact pinned snapshot and commit.
   * Business rules: Cache metadata and archive root must be valid and bound to the lookup; cache presence never replaces authorization performed by the caller.
   * Execution flow: 1. Read metadata for the derived cache key. 2. Validate pin, expiry, format, and wrapper metadata. 3. Open the private archive stream or remove an invalid entry.
   * Failure cases: Missing, expired, malformed, mismatched, or unreadable entries return null and invalid entries are removed.
   * Side effects: May open a temporary file stream, schedule TTL eviction, or delete an invalid cache entry.
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
        ...(metadata.archiveRoot === undefined
          ? {}
          : { archiveRoot: metadata.archiveRoot }),
        ...(metadata.treeManifest === undefined
          ? {}
          : { treeManifest: metadata.treeManifest }),
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
   * Business purpose: Preserve the exact provider archive and its format/root metadata for authorized reruns.
   * Business rules: Bytes and metadata are keyed by snapshot plus commit; temporary storage is private and cache failure never changes the downstream stream.
   * Execution flow: 1. Tee source bytes to the worker and a private temporary file. 2. On successful completion, atomically commit bytes and all archive metadata. 3. Remove partial state on failure.
   * Failure cases: Cache write failures reject completion and remove partial files while returning the original streaming path.
   * Side effects: Writes ephemeral private files, schedules eviction, and emits the source stream to the caller.
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
          ...(input.archiveRoot === undefined
            ? {}
            : { archiveRoot: input.archiveRoot }),
          ...(input.treeManifest === undefined
            ? {}
            : { treeManifest: input.treeManifest }),
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

/**
 * Business purpose: Trust cache metadata only when it preserves the exact pinned archive contract.
 * Business rules: Snapshot, commit, content type, resolved origin, expiry, and optional exact archive root must have safe types and values.
 * Execution flow: 1. Parse JSON. 2. Validate required fields and root shape. 3. Preserve a missing root as unknown and a null root as verified rootless.
 * Failure cases: Malformed or contradictory metadata returns null so the cache entry is discarded.
 * Side effects: Pure parsing and validation.
 */
function parseMetadata(value: string): SnapshotArchiveCacheMetadata | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.snapshotId !== "string" ||
      typeof parsed.commitSha !== "string" ||
      typeof parsed.contentType !== "string" ||
      typeof parsed.resolvedUrl !== "string" ||
      (parsed.archiveRoot !== undefined &&
        parsed.archiveRoot !== null &&
        (typeof parsed.archiveRoot !== "string" ||
          !isSafeArchiveRoot(parsed.archiveRoot))) ||
      (parsed.treeManifest !== undefined &&
        !isValidTreeManifest(parsed.treeManifest)) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }
    return {
      ...(parsed as SnapshotArchiveCacheMetadata),
      ...(parsed.archiveRoot === undefined
        ? {}
        : { archiveRoot: parsed.archiveRoot }),
      ...(parsed.treeManifest === undefined
        ? {}
        : { treeManifest: parsed.treeManifest as PinnedRepositoryTreeManifest }),
    };
  } catch {
    return null;
  }
}

function isValidTreeManifest(value: unknown): value is PinnedRepositoryTreeManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const manifest = value as Record<string, unknown>;
  return (
    manifest.version === 1 &&
    typeof manifest.commitSha === "string" &&
    /^[0-9a-f]{40}$/iu.test(manifest.commitSha) &&
    typeof manifest.treeId === "string" &&
    /^[0-9a-f]{40}$/iu.test(manifest.treeId) &&
    typeof manifest.fileCount === "number" &&
    Number.isSafeInteger(manifest.fileCount) &&
    manifest.fileCount >= 0 &&
    manifest.fileCount <= 100_000 &&
    typeof manifest.pathSha256 === "string" &&
    /^[0-9a-f]{64}$/iu.test(manifest.pathSha256)
  );
}

/**
 * Business purpose: Reject cache wrapper metadata that could alter repository-relative source paths ambiguously.
 * Business rules: Only one non-empty bounded path component is valid; absent metadata is handled separately as null.
 * Execution flow: Validate length, traversal tokens, separators, drive syntax, and controls.
 * Failure cases: Invalid components return false and cause the cache entry to be discarded.
 * Side effects: Pure validation.
 */
function isSafeArchiveRoot(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value !== "." &&
    value !== ".." &&
    !/[\\/:]/u.test(value) &&
    !containsControlCharacter(value)
  );
}

/**
 * Business purpose: Detect control characters that could make cache wrapper metadata ambiguous.
 * Business rules:
 * - C0 controls and DEL are not valid archive root components.
 * Execution flow:
 * 1. Inspect each code unit.
 * 2. Return true for a control value.
 * Failure cases:
 * - The caller treats true as invalid metadata and evicts the cache entry.
 * Side effects:
 * - Pure validation.
 */
function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
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
