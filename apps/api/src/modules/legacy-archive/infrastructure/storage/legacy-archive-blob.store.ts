import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { getRepoRoot } from "../../../../platform/logging/logging-context.js";

const REFERENCE = /^legacy-archive\/([0-9a-f]{64})\.blob$/u;

export type StoredLegacyBlob = {
  contentSha256: string;
  sizeBytes: number;
  storageRef: string;
};

/**
 * Byte-exact, content-addressed store for the few legacy report bytes that really existed.
 * It lives in its own `legacy-archive/` directory under the one protected blob root, so a V2
 * AssessmentArtifact chunk can never be confused with, or overwritten by, a legacy copy.
 */
@Injectable()
export class LegacyArchiveBlobStore {
  private readonly directory: string;

  constructor() {
    const root =
      process.env.LCSP_ARTIFACT_STORAGE_PATH ||
      path.join(getRepoRoot(), "tmp", "lcsp-storage");
    this.directory = path.join(root, "legacy-archive");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  /** Writes bytes once; an existing blob with the same hash must be byte-identical. */
  async write(bytes: Uint8Array): Promise<StoredLegacyBlob> {
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const target = path.join(this.directory, `${contentSha256}.blob`);
    try {
      await fs.promises.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error) || Reflect.get(error, "code") !== "EEXIST")
        throw error;
    }
    // Re-read what is on disk: identity is proven from storage, never from the in-memory source.
    const stored = await this.read(`legacy-archive/${contentSha256}.blob`);
    if (stored.length !== bytes.length || !Buffer.from(bytes).equals(stored))
      throw new Error("Legacy archive blob did not verify after write");
    return {
      contentSha256,
      sizeBytes: stored.length,
      storageRef: `legacy-archive/${contentSha256}.blob`,
    };
  }

  /** Reads and re-hashes; a corrupted or substituted file never leaves this method as valid. */
  async read(storageRef: string): Promise<Buffer> {
    const match = REFERENCE.exec(storageRef);
    if (!match) throw new Error("Invalid legacy archive blob reference");
    const bytes = await fs.promises.readFile(
      path.join(this.directory, `${match[1]}.blob`),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== match[1])
      throw new Error("Legacy archive blob hash mismatch");
    return bytes;
  }
}
