import { Injectable } from "@nestjs/common";

import { cleanString, isRecord } from "../../../../../common/utils/index.js";
import type {
  EvidenceFindingDto,
  EvidenceSeverity,
} from "../../contracts/evidence/evidence-detail.contract.js";

const EVIDENCE_SEVERITIES = new Set<EvidenceSeverity>([
  "LOW",
  "MEDIUM",
  "HIGH",
]);
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];

@Injectable()
export class EvidenceRedactorService {
  projectFindings(
    evidencePayload: unknown,
    redactLocations: boolean,
  ): EvidenceFindingDto[] {
    if (
      !isRecord(evidencePayload) ||
      !Array.isArray(evidencePayload.findings)
    ) {
      return [];
    }

    return evidencePayload.findings.flatMap((value) => {
      const finding = this.projectFinding(value, redactLocations);
      return finding ? [finding] : [];
    });
  }

  private projectFinding(
    value: unknown,
    redactLocations: boolean,
  ): EvidenceFindingDto | null {
    if (!isRecord(value)) return null;

    const findingId = cleanString(value.finding_id);
    const tool = cleanString(value.tool);
    const findingType = cleanString(value.finding_type);
    const severity = cleanSeverity(value.severity);
    const description = cleanString(value.description);
    const filePath = nullableString(value.file_path);
    const lineNumber = nullableLineNumber(value.line_number);

    if (
      !findingId ||
      !tool ||
      !findingType ||
      !severity ||
      !description ||
      filePath === undefined ||
      lineNumber === undefined ||
      containsSecret([findingId, tool, findingType, description, filePath])
    ) {
      return null;
    }

    return {
      finding_id: findingId,
      tool,
      finding_type: findingType,
      severity,
      description,
      file_path: redactLocations ? null : filePath,
      line_number: redactLocations ? null : lineNumber,
    };
  }
}

function cleanSeverity(value: unknown): EvidenceSeverity | null {
  const severity = cleanString(value);
  return severity && EVIDENCE_SEVERITIES.has(severity as EvidenceSeverity)
    ? (severity as EvidenceSeverity)
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return cleanString(value) ?? undefined;
}

function nullableLineNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function containsSecret(values: Array<string | null>): boolean {
  return values.some(
    (value) =>
      value !== null && SECRET_PATTERNS.some((pattern) => pattern.test(value)),
  );
}
