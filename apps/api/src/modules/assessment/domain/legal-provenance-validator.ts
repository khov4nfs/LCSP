import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";

export interface LegalProvenanceFailure {
  code:
    | "LEGAL_SOURCE_PIN_MISMATCH"
    | "LEGAL_SOURCE_REFERENCE_INVALID"
    | "LEGAL_SOURCE_HASH_MISMATCH"
    | "RULE_REQUIREMENT_LINK_INVALID"
    | "REPORT_PROVENANCE_INCOMPLETE";
  reference: string;
}

export interface LegalProvenanceSource {
  id: string;
  version: string;
  status: string;
}

export interface LegalProvenanceChunk {
  legalSourceVersionId: string;
  documentId: string;
  locator: string;
  contentSha256: string;
  legalStatus: string;
  sourceDocument: {
    legalSourceVersionId: string;
    documentId: string;
  } | null;
}

export interface LegalProvenanceReference {
  legalSourceVersionId: string;
  chunkId: string | null;
  documentId: string;
  locator: string;
  contentSha256: string;
  sourceEffectStatus: string | null;
  chunk: LegalProvenanceChunk | null;
}

export interface LegalProvenanceRequirement {
  id: string;
  ruleSetVersionId: string;
  legalRequirementId: string;
  coverageState: string;
  provenance: LegalProvenanceReference[];
}

export interface LegalProvenanceRule {
  assessmentRuleId: string;
  legalRequirementLinks: Array<{ legalRequirementRowId: string }>;
  contract: unknown;
}

export interface LegalProvenanceRuleChunk {
  id: string;
  legalSourceVersionId: string;
  documentId: string;
  locator: string;
  contentSha256: string;
  legalStatus: string;
}

const REPEALED_STATUS = "REPEALED";
const COVERED_BY_RULES = "COVERED_BY_ASSESSMENT_RULES";
const NON_ASSESSABLE = "NON_ASSESSABLE";

function add(
  failures: LegalProvenanceFailure[],
  code: LegalProvenanceFailure["code"],
  reference: string,
) {
  failures.push({ code, reference });
}

function sourceChunkIds(contract: unknown): string[] {
  if (!contract || typeof contract !== "object") return [];
  const ids = (contract as { sourceChunkIds?: unknown }).sourceChunkIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * Validates only the immutable identity and provenance links used by a final
 * report. It does not assess legal meaning, applicability, or compliance.
 */
export function validateLegalProvenance(input: {
  ruleSetVersionId: string;
  legalSourceVersionId: string | null;
  source: LegalProvenanceSource | null;
  requirements: LegalProvenanceRequirement[];
  rules: LegalProvenanceRule[];
  ruleChunks: LegalProvenanceRuleChunk[];
}): LegalProvenanceFailure[] {
  const failures: LegalProvenanceFailure[] = [];
  const {
    ruleSetVersionId,
    legalSourceVersionId,
    source,
    requirements,
    rules,
    ruleChunks,
  } = input;

  if (!legalSourceVersionId || !source || source.id !== legalSourceVersionId) {
    add(failures, "LEGAL_SOURCE_PIN_MISMATCH", ruleSetVersionId);
    return failures;
  }
  if (
    source.status !== LEGAL_SOURCE_LIFECYCLE_STATUSES.active &&
    source.status !== LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded
  ) {
    add(failures, "LEGAL_SOURCE_REFERENCE_INVALID", source.id);
  }

  const requirementsById = new Map(requirements.map((item) => [item.id, item]));
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.assessmentRuleId)) {
      add(failures, "RULE_REQUIREMENT_LINK_INVALID", rule.assessmentRuleId);
    }
    ruleIds.add(rule.assessmentRuleId);
    if (rule.legalRequirementLinks.length === 0) {
      add(failures, "RULE_REQUIREMENT_LINK_INVALID", rule.assessmentRuleId);
    }
    if (sourceChunkIds(rule.contract).length === 0) {
      add(failures, "REPORT_PROVENANCE_INCOMPLETE", rule.assessmentRuleId);
    }
    for (const link of rule.legalRequirementLinks) {
      const requirement = requirementsById.get(link.legalRequirementRowId);
      if (!requirement || requirement.ruleSetVersionId !== ruleSetVersionId) {
        add(
          failures,
          "RULE_REQUIREMENT_LINK_INVALID",
          `${rule.assessmentRuleId}:${link.legalRequirementRowId}`,
        );
        continue;
      }
      if (requirement.coverageState === NON_ASSESSABLE) {
        add(
          failures,
          "RULE_REQUIREMENT_LINK_INVALID",
          `${rule.assessmentRuleId}:${requirement.legalRequirementId}`,
        );
      }
      if (
        requirement.coverageState === COVERED_BY_RULES &&
        requirement.provenance.length === 0
      ) {
        add(
          failures,
          "REPORT_PROVENANCE_INCOMPLETE",
          requirement.legalRequirementId,
        );
      }
      for (const ref of requirement.provenance) {
        const refKey = `${requirement.legalRequirementId}:${ref.documentId}:${ref.locator}`;
        if (
          ref.legalSourceVersionId !== source.id ||
          ref.sourceEffectStatus === REPEALED_STATUS ||
          !ref.locator ||
          !ref.documentId ||
          !ref.contentSha256
        ) {
          add(failures, "LEGAL_SOURCE_REFERENCE_INVALID", refKey);
        }
        if (!ref.chunk) {
          add(failures, "REPORT_PROVENANCE_INCOMPLETE", refKey);
          continue;
        }
        if (
          ref.chunk.legalSourceVersionId !== source.id ||
          ref.chunk.documentId !== ref.documentId ||
          ref.chunk.locator !== ref.locator ||
          ref.chunk.sourceDocument?.legalSourceVersionId !== source.id ||
          ref.chunk.sourceDocument?.documentId !== ref.documentId ||
          ref.chunk.legalStatus === REPEALED_STATUS
        ) {
          add(failures, "LEGAL_SOURCE_REFERENCE_INVALID", refKey);
        }
        if (ref.chunk.contentSha256 !== ref.contentSha256) {
          add(failures, "LEGAL_SOURCE_HASH_MISMATCH", refKey);
        }
      }
    }
    for (const chunkId of sourceChunkIds(rule.contract)) {
      const matchingChunk = ruleChunks.find((chunk) => chunk.id === chunkId);
      if (!matchingChunk) {
        add(
          failures,
          "LEGAL_SOURCE_REFERENCE_INVALID",
          `${rule.assessmentRuleId}:${chunkId}`,
        );
      } else if (
        matchingChunk.legalSourceVersionId !== source.id ||
        matchingChunk.legalStatus === REPEALED_STATUS
      ) {
        add(
          failures,
          "LEGAL_SOURCE_REFERENCE_INVALID",
          `${rule.assessmentRuleId}:${chunkId}`,
        );
      }
    }
  }
  return failures;
}
