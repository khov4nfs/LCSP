import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { AppConfig } from "../../config/config.types.js";
import { getRepoRoot } from "../logging/logging-context.js";

/**
 * Strict regex for content-addressed artifact chunks:
 * Rationale (Why): Prevents CWE-22 directory traversal attacks (e.g. `..`, `../etc/passwd`)
 * and guarantees that only genuine chunk identifiers (`chunk-<index>`, `<name>.chunk`, 64-hex SHA-256 digest)
 * can ever be addressed in storage.
 * Mechanism (How): Matches either canonical `chunk-<index>` format, safe alphanumeric name with `.chunk`, or 64 lower-case hex characters.
 * Invariants (What): Never matches path separators, relative traversal sequences, or arbitrary non-chunk filenames.
 */
export const CHUNK_ID_PATTERN =
  /^(?:chunk-\d+|[a-zA-Z0-9_-]+\.chunk|[a-f0-9]{64})$/;

export const chunkedManifestSchema = z.strictObject({
  artifact_id: z.uuid(),
  total_size: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  chunks: z.array(z.string().regex(CHUNK_ID_PATTERN)).min(1),
});
export type ChunkedManifest = z.infer<typeof chunkedManifestSchema>;

/** Marks a verified collision or round-trip corruption in immutable storage. */
export class ArtifactStorageIntegrityError extends Error {}

/**
 * Business purpose: Derive the authoritative immutable-storage manifest before bytes are written.
 *
 * Business rules:
 * - The chunk identity is the SHA-256 digest of the exact UTF-8 content.
 * - A manifest is deterministic for the same artifact identifier and content.
 *
 * Execution flow:
 * 1. Hash the canonical content.
 * 2. Derive its content-addressed chunk identifier and UTF-8 byte length.
 * 3. Return the validated manifest metadata used by both database authority and storage writes.
 *
 * Failure cases:
 * - Invalid artifact identifiers are rejected by the strict manifest schema.
 *
 * Side effects:
 * - Pure computation; does not create directories or write artifact bytes.
 */
export function buildChunkedManifest(
  artifactId: string,
  content: string,
): { manifest: ChunkedManifest; sizeBytes: number } {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const manifest = chunkedManifestSchema.parse({
    artifact_id: artifactId,
    total_size: sizeBytes,
    hash,
    chunks: [`${hash}.chunk`],
  });
  return { manifest, sizeBytes };
}

@Injectable()
export class ArtifactStorageService {
  private readonly storagePath: string;

  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig>,
  ) {
    const configuredPath = this.configService?.get("storage", {
      infer: true,
    })?.artifactStoragePath;

    this.storagePath =
      configuredPath ||
      process.env.LCSP_ARTIFACT_STORAGE_PATH ||
      path.join(getRepoRoot(), "tmp", "lcsp-storage");
    const chunksDir = path.join(this.storagePath, "chunks");
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }
  }

  /**
   * Business purpose: Reconstruct and verify an immutable artifact payload from its stored chunk files.
   * Business rules:
   * - Each chunk ID must strictly match the 64-hex SHA-256 digest format with optional .chunk suffix.
   * - Resolved chunk file paths must strictly reside inside the designated chunks storage directory.
   * - Reconstructed total byte size must match the manifest total_size invariant.
   * - Reconstructed content SHA-256 digest must match the manifest hash invariant.
   * Execution flow:
   * 1. Validate manifest structure and chunk array non-emptiness.
   * 2. Iterate through each chunk ID, asserting hex hash format and directory containment.
   * 3. Read chunk file contents from disk and accumulate raw byte payload and size.
   * 4. Assert accumulated byte size equals manifest declared total_size.
   * 5. Compute SHA-256 hash of reconstructed payload and assert match with manifest hash.
   * 6. Return reconstructed UTF-8 artifact content string.
   * Failure cases:
   * - Throws BadRequestException if manifest structure is invalid or chunk array is missing.
   * - Throws BadRequestException if any chunk ID fails the 64-hex format check or escapes the chunks directory.
   * - Throws BadRequestException if any referenced chunk file does not exist on disk.
   * - Throws BadRequestException if accumulated size does not match manifest total_size.
   * - Throws BadRequestException if computed SHA-256 hash does not match manifest hash.
   * Side effects:
   * - Read-only operation on local filesystem storage with no persistence side-effects.
   */
  async readAndReconstruct(manifest: ChunkedManifest): Promise<string> {
    if (!manifest || !manifest.chunks || !Array.isArray(manifest.chunks)) {
      throw new BadRequestException("Invalid chunk manifest structure");
    }

    let reconstructed = "";
    let accumulatedSize = 0;

    const hashSum = crypto.createHash("sha256");
    const resolvedChunksDir = path.resolve(this.storagePath, "chunks");

    for (const chunkId of manifest.chunks) {
      // Rationale (Why): Validate format before path operations to reject traversal IDs like `..` immediately.
      // Mechanism (How): Check chunk ID against strict 64-hex SHA-256 regex.
      // Invariants (What): Non-hex characters or path delimiters throw BadRequestException.
      if (!CHUNK_ID_PATTERN.test(chunkId)) {
        throw new BadRequestException(`Invalid chunk ID format: ${chunkId}`);
      }

      // Rationale (Why): Defense-in-depth path containment verification preventing directory escape.
      // Mechanism (How): Resolve absolute path and assert prefix starts with resolved chunks directory + separator.
      // Invariants (What): Must reside strictly inside resolvedChunksDir.
      const chunkPath = path.resolve(resolvedChunksDir, chunkId);
      if (!chunkPath.startsWith(resolvedChunksDir + path.sep)) {
        throw new BadRequestException(
          `Invalid chunk path traversal: ${chunkId}`,
        );
      }

      if (!fs.existsSync(chunkPath)) {
        throw new BadRequestException(`Chunk not found: ${chunkId}`);
      }

      const content = await fs.promises.readFile(chunkPath, "utf8");
      reconstructed += content;
      accumulatedSize += Buffer.byteLength(content, "utf8");
    }

    if (accumulatedSize !== manifest.total_size) {
      throw new BadRequestException(
        `Artifact size mismatch. Manifest: ${manifest.total_size}, Reconstructed: ${accumulatedSize}`,
      );
    }

    hashSum.update(reconstructed);
    const calculatedHash = hashSum.digest("hex");
    if (calculatedHash !== manifest.hash) {
      throw new BadRequestException(
        `Artifact hash mismatch. Manifest: ${manifest.hash}, Calculated: ${calculatedHash}`,
      );
    }

    return reconstructed;
  }

  /**
   * Business purpose: Write an immutable, content-addressed artifact chunk to local storage and produce its manifest.
   * Business rules:
   * - Chunk ID must be derived from the SHA-256 digest of content with .chunk extension.
   * - Bytes are fsynced in a request-owned temporary file before an atomic hard-link publishes the canonical path.
   * - Existing files with matching content are treated as idempotent writes.
   * - The canonical content-addressed path is never overwritten or exposed while partially written.
   * Execution flow:
   * 1. Compute SHA-256 hash of incoming content string.
   * 2. Exclusively create, write, and fsync a unique temporary chunk in the storage directory.
   * 3. Atomically hard-link the complete temporary inode to the canonical content-addressed path.
   * 4. On canonical-path existence, verify the already published content matches exactly.
   * 5. Remove only the request-owned temporary link, verify round-trip reconstruction, and return the manifest.
   * Failure cases:
   * - Throws ArtifactStorageIntegrityError if an existing canonical chunk has mismatched content or verification fails.
   * - Filesystem creation, sync, link, and read failures propagate for dependency classification.
   * Side effects:
   * - Publishes at most one immutable canonical chunk and cleans its request-owned temporary link.
   */
  async writeImmutableArtifact(
    artifactId: string,
    content: string,
  ): Promise<{ manifest: ChunkedManifest; sizeBytes: number }> {
    // Database authority and the physical writer share this pure derivation so
    // BUILDING metadata cannot drift from the chunk later verified on disk.
    const { manifest, sizeBytes } = buildChunkedManifest(artifactId, content);
    const chunkId = manifest.chunks[0];
    const chunksDir = path.join(this.storagePath, "chunks");
    const chunkPath = path.join(chunksDir, chunkId);
    const temporaryPath = path.join(
      chunksDir,
      `.${chunkId}.${crypto.randomUUID()}.tmp`,
    );
    try {
      const temporaryFile = await fs.promises.open(temporaryPath, "wx", 0o600);
      try {
        await temporaryFile.writeFile(content, "utf8");
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }

      try {
        // Hard-link creation is atomic and fails rather than replacing a
        // canonical chunk already published by a concurrent same-digest call.
        await fs.promises.link(temporaryPath, chunkPath);
        const directory = await fs.promises.open(chunksDir, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          Reflect.get(error, "code") !== "EEXIST"
        ) {
          throw error;
        }
        const existing = await fs.promises.readFile(chunkPath, "utf8");
        if (existing !== content) {
          throw new ArtifactStorageIntegrityError(
            "Immutable artifact chunk hash collision",
            { cause: error },
          );
        }
      }
    } finally {
      try {
        await fs.promises.unlink(temporaryPath);
      } catch {
        // The temporary link is non-authoritative. Cleanup failure must not
        // replace a more important publication/integrity outcome; a later
        // maintenance sweep may remove orphaned dot-prefixed temp links.
      }
    }

    try {
      if ((await this.readAndReconstruct(manifest)) !== content) {
        throw new ArtifactStorageIntegrityError(
          "Stored artifact did not verify",
        );
      }
    } catch (error) {
      // The writer supplies its own freshly derived manifest, so a storage
      // BadRequest here proves round-trip corruption rather than client input.
      if (error instanceof BadRequestException) {
        throw new ArtifactStorageIntegrityError(
          "Stored artifact failed round-trip integrity verification",
          { cause: error },
        );
      }
      throw error;
    }
    return { manifest, sizeBytes };
  }

  /**
   * Business purpose: Safely erase an immutable artifact chunk from storage when no longer referenced.
   * Business rules:
   * - Only canonical single-chunk artifacts matching hash.chunk can be erased.
   * - Chunks present in the protectedChunks set must never be deleted.
   * - Target and parent paths must not traverse symbolic links.
   * Execution flow:
   * 1. Validate manifest structure against chunkedManifestSchema.
   * 2. Verify single-chunk identity matches manifest hash.
   * 3. Check protectedChunks set to preserve shared chunks.
   * 4. Verify path ancestry contains no symbolic links.
   * 5. Reconstruct artifact to verify integrity before deletion.
   * 6. Unlink target chunk file from disk.
   * Failure cases:
   * - Throws Error if manifest has invalid identity or multiple chunks.
   * - Throws Error if any parent directory or target file is a symbolic link.
   * - Throws Error if pre-erasure verification reconstruction fails.
   * Side effects:
   * - Deletes the targeted chunk file from disk storage.
   */
  async eraseImmutableArtifact(
    manifest: ChunkedManifest,
    protectedChunks: ReadonlySet<string>,
  ): Promise<void> {
    chunkedManifestSchema.parse(manifest);
    // Canonical reports use one content-addressed chunk; arbitrary paths never authorize erasure.
    if (
      manifest.chunks.length !== 1 ||
      manifest.chunks[0] !== `${manifest.hash}.chunk`
    )
      throw new Error("Invalid immutable artifact erasure identity");
    const chunk = manifest.chunks[0];
    if (protectedChunks.has(chunk)) return;
    const target = path.join(this.storagePath, "chunks", chunk);
    try {
      let parent = path.resolve(path.dirname(target));
      while (true) {
        if ((await fs.promises.lstat(parent)).isSymbolicLink())
          throw new Error("Invalid artifact erasure directory");
        const next = path.dirname(parent);
        if (next === parent) break;
        parent = next;
      }
      const stat = await fs.promises.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Invalid artifact erasure target");
      await this.readAndReconstruct(manifest);
      await fs.promises.unlink(target);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        Reflect.get(error, "code") !== "ENOENT"
      )
        throw error;
    }
  }
}
