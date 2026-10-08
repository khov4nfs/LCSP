import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { LEGACY_ARTIFACT_RECONCILIATION_REASONS as REASON } from "@lcsp/contracts/legacy-migration";

import type { LegacyReportReference } from "../../domain/legacy-report-reference.js";

export type LegacyReportReaderConfig = {
  /** Directories `file:` references may resolve into (realpath-checked). */
  fileRoots: readonly string[];
  /** Hosts that may be fetched over HTTP(S); everything else is never contacted. */
  httpHosts: ReadonlySet<string>;
  maxBytes: number;
  httpTimeoutMs: number;
};

export type LegacyReportReadResult =
  | { kind: "BYTES"; bytes: Buffer; sha256: string }
  | { kind: "MISSING" }
  | { kind: "OUTSIDE_ALLOWED_ROOT" }
  /** Presence could not be established (unreachable, unauthorised, server error): never classified. */
  | { kind: "UNDETERMINED" }
  /** Presence WAS established (file stat succeeded / HTTP 200) but the copy could not complete. */
  | {
      kind: "COPY_FAILED";
      reason:
        typeof REASON.COPY_IO_ERROR | typeof REASON.COPY_SIZE_LIMIT_EXCEEDED;
    };

export const DEFAULT_LEGACY_REPORT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Reads the bytes behind a V1 report reference, if and only if they really exist at a configured
 * location. It never fabricates content: absence is reported as absence.
 */
export class LegacyReportSourceReader {
  constructor(private readonly config: LegacyReportReaderConfig) {}

  async read(
    reference: LegacyReportReference,
  ): Promise<LegacyReportReadResult> {
    if (reference.kind === "FILE") return this.readFile(reference.path);
    if (reference.kind === "HTTP") return this.readHttp(reference.url);
    return { kind: "MISSING" };
  }

  private async readFile(candidate: string): Promise<LegacyReportReadResult> {
    let real: string;
    try {
      real = await fs.promises.realpath(candidate);
    } catch (error) {
      return Reflect.get(error as object, "code") === "ENOENT"
        ? { kind: "MISSING" }
        : { kind: "UNDETERMINED" };
    }
    const inside = await this.insideAnyRoot(real);
    if (!inside) return { kind: "OUTSIDE_ALLOWED_ROOT" };
    let size: number;
    try {
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) return { kind: "MISSING" };
      size = stat.size;
    } catch {
      return { kind: "UNDETERMINED" };
    }
    // From here the file exists, so any failure is a failed copy of a present artifact.
    if (size > this.config.maxBytes)
      return { kind: "COPY_FAILED", reason: REASON.COPY_SIZE_LIMIT_EXCEEDED };
    try {
      const bytes = await fs.promises.readFile(real);
      return { kind: "BYTES", bytes, sha256: sha256(bytes) };
    } catch {
      return { kind: "COPY_FAILED", reason: REASON.COPY_IO_ERROR };
    }
  }

  private async insideAnyRoot(real: string): Promise<boolean> {
    for (const root of this.config.fileRoots) {
      let realRoot: string;
      try {
        realRoot = await fs.promises.realpath(root);
      } catch {
        continue;
      }
      if (real === realRoot || real.startsWith(realRoot + path.sep))
        return true;
    }
    return false;
  }

  private async readHttp(url: URL): Promise<LegacyReportReadResult> {
    if (!this.config.httpHosts.has(url.hostname.toLowerCase()))
      return { kind: "OUTSIDE_ALLOWED_ROOT" };
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.httpTimeoutMs,
    );
    try {
      let response: Response;
      try {
        // A redirect could leave the allowlisted host, so it is never followed.
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        return { kind: "UNDETERMINED" };
      }
      if (response.status === 404 || response.status === 410)
        return { kind: "MISSING" };
      if (response.status !== 200 || !response.body)
        return { kind: "UNDETERMINED" };
      // HTTP 200: presence is established; everything below is a failed copy of a present artifact.
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > this.config.maxBytes)
        return { kind: "COPY_FAILED", reason: REASON.COPY_SIZE_LIMIT_EXCEEDED };
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          total += chunk.byteLength;
          if (total > this.config.maxBytes)
            return {
              kind: "COPY_FAILED",
              reason: REASON.COPY_SIZE_LIMIT_EXCEEDED,
            };
          chunks.push(Buffer.from(chunk));
        }
      } catch {
        return { kind: "COPY_FAILED", reason: REASON.COPY_IO_ERROR };
      }
      const bytes = Buffer.concat(chunks);
      return { kind: "BYTES", bytes, sha256: sha256(bytes) };
    } finally {
      clearTimeout(timer);
    }
  }
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
