import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";

import {
  ArtifactStorageIntegrityError,
  ArtifactStorageService,
} from "./artifact-storage.service.js";

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
    const chunk1Id = `${"1".repeat(64)}.chunk`;
    const chunk2Id = `${"2".repeat(64)}.chunk`;

    fs.mkdirSync(path.join(testStoragePath, "chunks"), { recursive: true });
    fs.writeFileSync(
      path.join(testStoragePath, "chunks", chunk1Id),
      chunk1,
      "utf8",
    );
    fs.writeFileSync(
      path.join(testStoragePath, "chunks", chunk2Id),
      chunk2,
      "utf8",
    );

    const manifest = {
      artifact_id: "art-123",
      total_size: totalSize,
      hash,
      chunks: [chunk1Id, chunk2Id],
    };

    const reconstructed = await service.readAndReconstruct(manifest);
    expect(reconstructed).toBe(originalContent);
  });

  it("throws BadRequestException on hash mismatch", async () => {
    const chunk1Id = `${"1".repeat(64)}.chunk`;
    const manifest = {
      artifact_id: "art-123",
      total_size: 14,
      hash: "invalid-hash",
      chunks: [chunk1Id],
    };

    await expect(service.readAndReconstruct(manifest)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws BadRequestException on size mismatch", async () => {
    const chunk1Id = `${"1".repeat(64)}.chunk`;
    const manifest = {
      artifact_id: "art-123",
      total_size: 99999,
      hash: crypto.createHash("sha256").update("Hello, world! ").digest("hex"),
      chunks: [chunk1Id],
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

  it("[RED][ASM-REPORT-02] marks write round-trip corruption as storage integrity failure", async () => {
    jest
      .spyOn(service, "readAndReconstruct")
      .mockRejectedValueOnce(new BadRequestException("private chunk mismatch"));

    await expect(
      service.writeImmutableArtifact(
        crypto.randomUUID(),
        "round-trip integrity payload",
      ),
    ).rejects.toBeInstanceOf(ArtifactStorageIntegrityError);
  });

  it("converges concurrent same-content writes without exposing a partial canonical chunk", async () => {
    const content = "concurrent immutable publication";
    const stored = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.writeImmutableArtifact(crypto.randomUUID(), content),
      ),
    );

    expect(new Set(stored.map(({ manifest }) => manifest.hash)).size).toBe(1);
    await expect(service.readAndReconstruct(stored[0].manifest)).resolves.toBe(
      content,
    );
    expect(
      fs
        .readdirSync(path.join(testStoragePath, "chunks"))
        .filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects traversal chunk ID '..' escaping chunks directory (RED reproducer)", async () => {
    const manifest = {
      artifact_id: crypto.randomUUID(),
      total_size: 10,
      hash: "a".repeat(64),
      chunks: [".."],
    };
    await expect(service.readAndReconstruct(manifest)).rejects.toThrow(
      new BadRequestException("Invalid chunk ID format: .."),
    );
  });

  it("rejects non-hex-hash chunk names (e.g. arbitrary file targets) (RED reproducer)", async () => {
    const manifest = {
      artifact_id: crypto.randomUUID(),
      total_size: 10,
      hash: "a".repeat(64),
      chunks: ["arbitrary-name.txt"],
    };
    await expect(service.readAndReconstruct(manifest)).rejects.toThrow(
      new BadRequestException("Invalid chunk ID format: arbitrary-name.txt"),
    );
  });

  it("erases verified immutable bytes idempotently and preserves another artifact", async () => {
    const owned = await service.writeImmutableArtifact(
      crypto.randomUUID(),
      "owned synthetic report",
    );
    const other = await service.writeImmutableArtifact(
      crypto.randomUUID(),
      "another synthetic report",
    );
    await service.eraseImmutableArtifact(
      owned.manifest,
      new Set(other.manifest.chunks),
    );
    await service.eraseImmutableArtifact(
      owned.manifest,
      new Set(other.manifest.chunks),
    );
    expect(
      fs.existsSync(
        path.join(testStoragePath, "chunks", owned.manifest.chunks[0]),
      ),
    ).toBe(false);
    await expect(service.readAndReconstruct(other.manifest)).resolves.toBe(
      "another synthetic report",
    );
  });

  it("preserves a content-addressed chunk still owned by another assessment", async () => {
    const stored = await service.writeImmutableArtifact(
      crypto.randomUUID(),
      "shared synthetic chunk",
    );
    await service.eraseImmutableArtifact(
      stored.manifest,
      new Set(stored.manifest.chunks),
    );
    await expect(service.readAndReconstruct(stored.manifest)).resolves.toBe(
      "shared synthetic chunk",
    );
  });

  it("refuses hash-tampered and symlinked erasure targets", async () => {
    const stored = await service.writeImmutableArtifact(
      crypto.randomUUID(),
      "verify before erase",
    );
    const target = path.join(
      testStoragePath,
      "chunks",
      stored.manifest.chunks[0],
    );
    fs.writeFileSync(target, "tampered");
    await expect(
      service.eraseImmutableArtifact(stored.manifest, new Set()),
    ).rejects.toThrow();
    expect(fs.existsSync(target)).toBe(true);
    fs.unlinkSync(target);
    fs.symlinkSync(
      path.join(testStoragePath, "chunks", `${"1".repeat(64)}.chunk`),
      target,
    );
    await expect(
      service.eraseImmutableArtifact(stored.manifest, new Set()),
    ).rejects.toThrow();
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
  });
});
