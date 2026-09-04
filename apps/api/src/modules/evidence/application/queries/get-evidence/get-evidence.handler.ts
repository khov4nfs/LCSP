import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  SCAN_EVIDENCE_SCHEMA_VERSIONS,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { isRecord } from "../../../../../common/utils/index.js";
import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  EvidenceDetailDto,
  EvidencePrivacyFlagsDto,
} from "../../contracts/evidence/evidence-detail.contract.js";
import { EvidenceRedactorService } from "../../services/evidence/evidence-redactor.service.js";
import { GetEvidenceQuery } from "./get-evidence.query.js";

@QueryHandler(GetEvidenceQuery)
export class GetEvidenceHandler implements IQueryHandler<GetEvidenceQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: EvidenceRedactorService,
  ) {}

  async execute(query: GetEvidenceQuery): Promise<EvidenceDetailDto> {
    const redactLocations = query.actorRole === AUTH_USER_ROLES.admin;
    if (
      query.actorRole !== AUTH_USER_ROLES.customer &&
      query.actorRole !== AUTH_USER_ROLES.admin
    ) {
      this.throwNotFound(query.correlationId);
    }

    const report = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        assessmentId: query.assessmentId,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        assessmentId: true,
        toolsVersion: true,
        configHash: true,
        evidencePayload: true,
        privacyFlags: true,
        schemaVersion: true,
        status: true,
        createdAt: true,
      },
    });
    if (!report) this.throwNotFound(query.correlationId);

    const toolsVersion = stringRecord(report.toolsVersion);
    const configHash = stringRecord(report.configHash);
    const privacyFlags = safePrivacyFlags(report.privacyFlags);
    if (
      !toolsVersion ||
      !configHash ||
      !privacyFlags ||
      !SCAN_EVIDENCE_SCHEMA_VERSIONS.includes(
        report.schemaVersion as (typeof SCAN_EVIDENCE_SCHEMA_VERSIONS)[number],
      )
    ) {
      this.throwNotFound(query.correlationId);
    }

    return {
      evidence_report_id: report.id,
      assessment_id: report.assessmentId,
      schema_version: report.schemaVersion,
      tools_version: toolsVersion,
      config_hash: configHash,
      findings: this.redactor.projectFindings(
        report.evidencePayload,
        redactLocations,
      ),
      privacy_flags: privacyFlags,
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      created_at: report.createdAt.toISOString(),
      correlationId: query.correlationId,
    };
  }

  private throwNotFound(correlationId: string): never {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, entry]) =>
        !key.trim() ||
        typeof entry !== "string" ||
        !entry.trim() ||
        containsSecret(key) ||
        containsSecret(entry),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => [key.trim(), (entry as string).trim()]),
  );
}

const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];

function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function safePrivacyFlags(value: unknown): EvidencePrivacyFlagsDto | null {
  return isRecord(value) &&
    value.containsSourceCode === false &&
    value.secretsRedacted === true
    ? { containsSourceCode: false, secretsRedacted: true }
    : null;
}
