import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import { Injectable, NotFoundException } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type {
  AiDiscoverySnippetRef,
  AssessmentInterviewSourceSnippet,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { RepositoryScanJobStatus } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  containsSensitiveCredentialText,
  sanitizeAgentStreamText,
} from "../../../../platform/runtime-events/agent-stream-sanitizer.js";
import type { SnapshotArchiveStreamResult } from "../../../github-integration/application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "../../../github-integration/application/queries/stream-snapshot-archive/stream-snapshot-archive.query.js";

const MAX_SNIPPET_LINES = 7;
const MAX_SNIPPET_BYTES = 4096;
const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const TAR_BLOCK_SIZE = 512;
const REDACTED = "[REDACTED]";

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
  /((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
] as const;

/**
 * Resolves the short source excerpt attached to an Interview question from the exact
 * pinned repository snapshot. Raw source is transient: it is neither persisted nor
 * returned outside the locator's bounded line range.
 */
@Injectable()
export class AssessmentInterviewSnippetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async resolve(input: {
    assessmentId: string;
    correlationId: string;
    evidenceReportId: string;
    snippetRef: AiDiscoverySnippetRef;
  }): Promise<AssessmentInterviewSourceSnippet> {
    assertSnippetRef(input.snippetRef);

    const evidenceReport = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        id: input.evidenceReportId,
        assessmentId: input.assessmentId,
        snapshotId: input.snippetRef.snapshot_id,
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
      select: { evidencePayload: true },
    });
    if (
      !evidenceReport ||
      !isGovernedSnippetRef(evidenceReport.evidencePayload, input.snippetRef)
    ) {
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE",
      });
    }

    const snapshot = await this.prisma.repositorySnapshot.findFirst({
      where: {
        id: input.snippetRef.snapshot_id,
        assessmentId: input.assessmentId,
        commitSha: input.snippetRef.commit_sha,
      },
      select: { id: true, commitSha: true },
    });
    if (!snapshot) {
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE",
      });
    }

    const scanJob = await this.prisma.repositoryScanJob.findFirst({
      where: {
        snapshotId: snapshot.id,
        status: RepositoryScanJobStatus.COMPLETED,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!scanJob) {
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE",
      });
    }

    const archive = await this.queryBus.execute<
      StreamSnapshotArchiveQuery,
      SnapshotArchiveStreamResult
    >(
      new StreamSnapshotArchiveQuery(
        snapshot.id,
        scanJob.id,
        input.correlationId,
      ),
    );
    if (
      archive.snapshotId !== input.snippetRef.snapshot_id ||
      archive.commitSha !== input.snippetRef.commit_sha
    ) {
      (archive.stream as { destroy?: () => void }).destroy?.();
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE",
      });
    }

    const source = await readFileFromGzipTar(
      archive.stream,
      input.snippetRef.file_path,
    );
    const hash = `sha256:${createHash("sha256").update(source).digest("hex")}`;
    if (hash !== input.snippetRef.evidence_hash.toLowerCase()) {
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_HASH_MISMATCH",
      });
    }

    const text = source.toString("utf8");
    // Redact against the complete transient file before selecting the display range so
    // multiline secrets (for example PEM private keys) cannot leak when the bounded
    // excerpt begins or ends inside the secret block. Neither raw nor redacted full
    // source is persisted.
    const sanitizedText = redactSecrets(text);
    const allLines = text.split(/\r?\n/u);
    const sanitizedLines = sanitizedText.split(/\r?\n/u);
    const start = input.snippetRef.start_line;
    const end = Math.min(input.snippetRef.end_line, allLines.length);
    let remainingBytes = MAX_SNIPPET_BYTES;
    let redacted = false;
    let truncated = end < input.snippetRef.end_line;
    const lines: AssessmentInterviewSourceSnippet["lines"] = [];

    for (
      let line = start;
      line <= end && lines.length < MAX_SNIPPET_LINES;
      line += 1
    ) {
      const original = allLines[line - 1] ?? "";
      const preSanitized = sanitizedLines[line - 1] ?? "";
      const sanitized = containsSensitiveCredentialText(original)
        ? REDACTED
        : (sanitizeAgentStreamText(preSanitized) ?? REDACTED);
      redacted ||= sanitized !== original;
      const separatorBytes = lines.length > 0 ? 1 : 0;
      if (remainingBytes <= separatorBytes) {
        truncated = true;
        break;
      }
      const bounded = boundUtf8(sanitized, remainingBytes - separatorBytes);
      if (bounded.truncated) truncated = true;
      lines.push({ line, text: bounded.value });
      remainingBytes -=
        separatorBytes + Buffer.byteLength(bounded.value, "utf8");
      if (remainingBytes <= 0) {
        truncated = line < end || truncated;
        break;
      }
    }

    return {
      snippetRef: input.snippetRef,
      lines,
      redacted,
      truncated,
    };
  }
}

function isGovernedSnippetRef(
  evidencePayload: unknown,
  ref: AiDiscoverySnippetRef,
): boolean {
  const payload = objectRecord(evidencePayload);
  const discovery = objectRecord(payload?.ai_discovery ?? payload?.aiDiscovery);
  const findings = Array.isArray(discovery?.findings) ? discovery.findings : [];
  return findings.some((finding) => {
    const record = objectRecord(finding);
    const candidate = objectRecord(record?.snippet_ref ?? record?.snippetRef);
    if (!candidate) return false;
    const candidateFilePath = candidate.file_path;
    const candidateSymbol = candidate.symbol;
    const candidateEvidenceHash = candidate.evidence_hash;
    if (
      typeof candidateFilePath !== "string" ||
      (candidateSymbol !== undefined && typeof candidateSymbol !== "string") ||
      typeof candidateEvidenceHash !== "string"
    ) {
      return false;
    }
    return (
      candidate.snapshot_id === ref.snapshot_id &&
      candidate.commit_sha === ref.commit_sha &&
      normalizeArchivePath(candidateFilePath) ===
        normalizeArchivePath(ref.file_path) &&
      Number(candidate.start_line) === ref.start_line &&
      Number(candidate.end_line) === ref.end_line &&
      (candidateSymbol ?? "") === (ref.symbol ?? "") &&
      candidateEvidenceHash.toLowerCase() === ref.evidence_hash.toLowerCase() &&
      candidate.snippet_policy === ref.snippet_policy
    );
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertSnippetRef(ref: AiDiscoverySnippetRef): void {
  const normalized = ref.file_path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    ref.snippet_policy !== "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1" ||
    !ref.snapshot_id?.trim() ||
    !ref.commit_sha?.trim() ||
    !normalized ||
    normalized.split("/").includes("..") ||
    !Number.isSafeInteger(ref.start_line) ||
    !Number.isSafeInteger(ref.end_line) ||
    ref.start_line < 1 ||
    ref.end_line < ref.start_line ||
    ref.end_line - ref.start_line + 1 > MAX_SNIPPET_LINES ||
    !/^sha256:[0-9a-f]{64}$/i.test(ref.evidence_hash)
  ) {
    throw new NotFoundException({ code: "INTERVIEW_SOURCE_SNIPPET_INVALID" });
  }
}

async function readFileFromGzipTar(
  source: NodeJS.ReadableStream,
  filePath: string,
): Promise<Buffer> {
  const gunzip = createGunzip();
  const input = source as Readable;
  input.once("error", (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const reader = new AsyncByteReader(gunzip);
  const target = normalizeArchivePath(filePath);

  let uncompressedBytes = 0;
  try {
    while (true) {
      const header = await reader.readExactly(TAR_BLOCK_SIZE);
      if (!header || header.every((value) => value === 0)) break;
      uncompressedBytes += TAR_BLOCK_SIZE;
      if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new NotFoundException({
          code: "INTERVIEW_SOURCE_SNIPPET_ARCHIVE_TOO_LARGE",
        });
      }

      const member = tarMember(header);
      if (member.size < 0) break;
      const memberBytes = member.size + paddingFor(member.size);
      if (uncompressedBytes + memberBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new NotFoundException({
          code: "INTERVIEW_SOURCE_SNIPPET_ARCHIVE_TOO_LARGE",
        });
      }
      uncompressedBytes += memberBytes;
      if (
        member.size > MAX_SOURCE_FILE_BYTES &&
        archivePathMatches(member.name, target)
      ) {
        throw new NotFoundException({
          code: "INTERVIEW_SOURCE_SNIPPET_FILE_TOO_LARGE",
        });
      }

      if (member.regular && archivePathMatches(member.name, target)) {
        const body = await reader.readExactly(member.size);
        if (!body) break;
        await reader.skip(paddingFor(member.size));
        input.destroy();
        gunzip.destroy();
        return body;
      }

      await reader.skip(memberBytes);
    }
  } finally {
    input.destroy();
    gunzip.destroy();
  }

  throw new NotFoundException({ code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE" });
}

function tarMember(header: Buffer): {
  name: string;
  size: number;
  regular: boolean;
} {
  const name = readTarString(header.subarray(0, 100));
  const prefix = readTarString(header.subarray(345, 500));
  const sizeRaw = readTarString(header.subarray(124, 136)).trim();
  const size = sizeRaw
    ? Number.parseInt(sizeRaw.replace(/\0/g, "").trim(), 8)
    : 0;
  const type = header[156] ?? 0;
  return {
    name: normalizeArchivePath(prefix ? `${prefix}/${name}` : name),
    size: Number.isFinite(size) && size >= 0 ? size : -1,
    regular: type === 0 || type === 48,
  };
}

function readTarString(value: Buffer): string {
  const zero = value.indexOf(0);
  return value
    .subarray(0, zero >= 0 ? zero : value.length)
    .toString("utf8")
    .trim();
}

function archivePathMatches(memberName: string, target: string): boolean {
  const member = normalizeArchivePath(memberName);
  if (member === target) return true;
  const firstSlash = member.indexOf("/");
  return firstSlash >= 0 && member.slice(firstSlash + 1) === target;
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function paddingFor(size: number): number {
  return (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
}

function redactSecrets(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === "string" && prefix.length > 0) {
        return `${prefix}${REDACTED}${match.endsWith("@") ? "@" : ""}`;
      }
      const newlineCount = (match.match(/\n/g) ?? []).length;
      return `${REDACTED}${"\n".repeat(newlineCount)}`;
    });
  }
  return result;
}

function boundUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  if (maxBytes <= 0) return { value: "", truncated: value.length > 0 };
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { value, truncated: false };
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return { value: value.slice(0, low), truncated: true };
}

class AsyncByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private buffered: Buffer = Buffer.alloc(0);

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  async readExactly(size: number): Promise<Buffer | null> {
    if (size === 0) return Buffer.alloc(0);
    while (this.buffered.length < size) {
      const next = await this.iterator.next();
      if (next.done) return null;
      const chunk = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value as unknown as Uint8Array);
      this.buffered = this.buffered.length
        ? Buffer.concat([this.buffered, chunk])
        : chunk;
    }
    const result = this.buffered.subarray(0, size);
    this.buffered = this.buffered.subarray(size);
    return result;
  }

  async skip(size: number): Promise<void> {
    let remaining = size;
    while (remaining > 0) {
      const take = Math.min(remaining, 64 * 1024);
      const chunk = await this.readExactly(take);
      if (!chunk) return;
      remaining -= chunk.length;
    }
  }
}
