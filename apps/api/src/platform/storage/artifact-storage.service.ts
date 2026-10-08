import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { getRepoRoot } from "../logging/logging-context.js";

export const chunkedManifestSchema = z.strictObject({
  artifact_id: z.uuid(),
  total_size: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  chunks: z.array(z.string().regex(/^[a-zA-Z0-9_\-.]+$/)).min(1),
});
export type ChunkedManifest = z.infer<typeof chunkedManifestSchema>;

export type StoredJsonArtifact = Record<string, unknown>;

@Injectable()
export class ArtifactStorageService {
  private readonly storagePath: string;

  constructor() {
    this.storagePath =
      process.env.LCSP_ARTIFACT_STORAGE_PATH ||
      path.join(getRepoRoot(), "tmp", "lcsp-storage");
    const chunksDir = path.join(this.storagePath, "chunks");
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }
  }

  async readAndReconstruct(manifest: ChunkedManifest): Promise<string> {
    if (!manifest || !manifest.chunks || !Array.isArray(manifest.chunks)) {
      throw new BadRequestException("Invalid chunk manifest structure");
    }

    let reconstructed = "";
    let accumulatedSize = 0;

    const hashSum = crypto.createHash("sha256");

    for (const chunkId of manifest.chunks) {
      if (!/^[a-zA-Z0-9_\-.]+$/.test(chunkId)) {
        throw new BadRequestException(`Invalid chunk ID format: ${chunkId}`);
      }

      const chunkPath = path.join(this.storagePath, "chunks", chunkId);
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
        !(error instanceof Error) ||
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

  async readJsonArtifactReference(
    reference: string,
  ): Promise<StoredJsonArtifact> {
    const artifactPath = this.resolveJsonArtifactReference(reference);
    const content = await fs.promises.readFile(artifactPath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new BadRequestException("Invalid JSON artifact");
    }
    return parsed as StoredJsonArtifact;
  }

  /** Returns size/mtime of a JSON artifact reference without reading its content. */
  async statJsonArtifactReference(
    reference: string,
  ): Promise<{ size: number; mtimeMs: number }> {
    const stat = await fs.promises.stat(
      this.resolveJsonArtifactReference(reference),
    );
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  }

  private resolveJsonArtifactReference(reference: string): string {
    if (typeof reference !== "string" || !reference.trim()) {
      throw new BadRequestException("Invalid artifact reference");
    }
    const normalized = reference.replaceAll("\\", "/");
    const marker = "/app/deepagents/tmp/";
    const relative = normalized.startsWith(marker)
      ? normalized.slice(marker.length)
      : normalized;
    if (!/^[a-zA-Z0-9_./-]+\.json$/.test(relative) || relative.includes("..")) {
      throw new BadRequestException("Invalid artifact reference");
    }
    const root =
      process.env.LCSP_GRAPH_STORAGE_PATH || path.join(getRepoRoot(), "tmp");
    const artifactPath = path.resolve(root, relative);
    const storageRoot = path.resolve(root) + path.sep;
    if (!artifactPath.startsWith(storageRoot)) {
      throw new BadRequestException("Invalid artifact reference");
    }
    return artifactPath;
  }
}
