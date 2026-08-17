import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";

import { ArtifactStorageService } from "./artifact-storage.service.js";

describe("ArtifactStorageService", () => {
  let service: ArtifactStorageService;
  const testStoragePath = path.join(process.cwd(), "tmp", "lcsp-storage-test");

  beforeAll(() => {
    process.env.LCSP_ARTIFACT_STORAGE_PATH = testStoragePath;
    service = new ArtifactStorageService();
  });

  afterAll(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.rmSync(testStoragePath, { recursive: true, force: true });
    }
  });

  it("reconstructs content successfully from valid chunks and matches hash/size", async () => {
    const originalContent =
      "Hello, world! This is a test of chunked artifact reconstruction.";
    const hash = crypto
      .createHash("sha256")
      .update(originalContent)
      .digest("hex");
    const totalSize = Buffer.byteLength(originalContent, "utf8");

    const chunk1 = "Hello, world! ";
    const chunk2 = "This is a test of chunked artifact reconstruction.";

    fs.mkdirSync(path.join(testStoragePath, "chunks"), { recursive: true });
    fs.writeFileSync(
      path.join(testStoragePath, "chunks", "chunk1.json"),
      chunk1,
      "utf8",
    );
    fs.writeFileSync(
      path.join(testStoragePath, "chunks", "chunk2.json"),
      chunk2,
      "utf8",
    );

    const manifest = {
      artifact_id: "art-123",
      total_size: totalSize,
      hash,
      chunks: ["chunk1.json", "chunk2.json"],
    };

    const reconstructed = await service.readAndReconstruct(manifest);
    expect(reconstructed).toBe(originalContent);
  });

  it("throws BadRequestException on hash mismatch", async () => {
    const manifest = {
      artifact_id: "art-123",
      total_size: 14,
      hash: "invalid-hash",
      chunks: ["chunk1.json"],
    };

    await expect(service.readAndReconstruct(manifest)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws BadRequestException on size mismatch", async () => {
    const manifest = {
      artifact_id: "art-123",
      total_size: 99999,
      hash: crypto.createHash("sha256").update("Hello, world! ").digest("hex"),
      chunks: ["chunk1.json"],
    };

    await expect(service.readAndReconstruct(manifest)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws BadRequestException on path traversal in chunk ID", async () => {
    const manifest = {
      artifact_id: "art-123",
      total_size: 14,
      hash: "some-hash",
      chunks: ["../chunk1.json"],
    };

    await expect(service.readAndReconstruct(manifest)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
