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
 * and guarantees that only genuine chunk identifiers (`chunk-<index>`, 64-hex SHA-256 digest, or `hash.chunk`)
 * can ever be addressed in storage.
 * Mechanism (How): Matches either canonical `chunk-<index>` format or 64 lower-case hex characters with optional `.chunk`.
 * Invariants (What): Never matches path separators, relative traversal sequences, or arbitrary filenames.
 */
export const CHUNK_ID_PATTERN = /^(?:chunk-\d+|[a-f0-9]{64}(\.chunk)?)$/;

export const chunkedManifestSchema = z.strictObject({
  artifact_id: z.uuid(),
  total_size: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  chunks: z.array(z.string().regex(CHUNK_ID_PATTERN)).min(1),
});
export type ChunkedManifest = z.infer<typeof chunkedManifestSchema>;

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
   * - Write operation must use exclusive flag ('wx') and restrictive permissions (0o600).
   * - Existing files with matching content are treated as idempotent writes.
   * - Hash collisions with mismatched content must be rejected immediately.
   * Execution flow:
   * 1. Compute SHA-256 hash of incoming content string.
   * 2. Attempt atomic write to chunks directory with exclusive creation flag.
   * 3. On file existence error, verify existing file content matches input content.
   * 4. Construct ChunkedManifest and verify round-trip reconstruction.
   * 5. Return generated manifest and byte size.
   * Failure cases:
   * - Throws Error if an existing chunk with identical hash has mismatched content.
   * - Throws Error if round-trip reconstruction verification fails.
   * Side effects:
   * - Persists a new immutable chunk file to the disk chunks directory.
   */
  async writeImmutableArtifact(
    artifactId: string,
    content: string,
  ): Promise<{ manifest: ChunkedManifest; sizeBytes: number }> {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const chunkId = `${hash}.chunk`;
    const chunkPath = path.join(this.storagePath, "chunks", chunkId);
    try {
      await fs.promises.writeFile(chunkPath, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
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
        throw new Error("Immutable artifact chunk hash collision", {
          cause: error,
        });
      }
    }

    const manifest: ChunkedManifest = {
      artifact_id: artifactId,
      total_size: Buffer.byteLength(content, "utf8"),
      hash,
      chunks: [chunkId],
    };
    if ((await this.readAndReconstruct(manifest)) !== content) {
      throw new Error("Stored artifact did not verify");
    }
    return { manifest, sizeBytes: manifest.total_size };
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
