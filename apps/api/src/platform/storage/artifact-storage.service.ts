import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { BadRequestException, Injectable } from "@nestjs/common";
import { getRepoRoot } from "../logging/logging-context.js";

export interface ChunkedManifest {
  artifact_id: string;
  total_size: number;
  hash: string;
  chunks: string[];
}

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
}
