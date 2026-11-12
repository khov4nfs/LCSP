import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Review-only projection. It does not change legal source, claims, validation or ACTIVE rule sets.
const TYPES = new Set([
  "DEVELOPMENT_CANDIDATE",
  "SPLIT_DEV_AND_NONDEV",
  "CONTEXT_ONLY_IF_LINKED",
  "EXCLUDE_FROM_DEV_CATALOG",
  "LEGAL_REVIEW_REQUIRED",
]);
const RELATIONS = new Set([
  "CONDITION_OF",
  "QUALIFIES",
  "EXCEPTION_TO",
  "DEFINED_BY",
  "TEMPORALLY_APPLIES_TO",
  "INCORPORATES",
  "PRESERVES",
  "CONTEXT_FOR",
  "CROSS_REFERENCE",
]);
const NODE_ID = /^[a-f0-9]{64}$/i;

export function buildDevelopmentReviewView(
  triage,
  { materialLinks = [] } = {},
) {
  if (
    triage?.documentType !== "DEVELOPMENT_ONLY_PREPARATION_SCOPE_TRIAGE" ||
    triage?.targetScope !== "DEVELOPMENT_ONLY" ||
    triage?.status !== "DRAFT_NOT_ACTIVE" ||
    !Array.isArray(triage.rows) ||
    !Array.isArray(materialLinks)
  ) {
    throw new Error("Invalid or untrusted development review input");
  }
  const buckets = Object.fromEntries([...TYPES].map((kind) => [kind, []]));
  const units = new Map();
  for (const row of triage.rows) {
    if (
      !row ||
      !TYPES.has(row.stageTriage) ||
      !row.legalUnitId ||
      !row.canonicalLocator ||
      !row.documentNumber ||
      units.has(row.legalUnitId) ||
      row.humanApproved === true
    ) {
      throw new Error(
        "Invalid, duplicated or prematurely approved source unit",
      );
    }
    units.set(row.legalUnitId, row);
    buckets[row.stageTriage].push(row);
  }
  // Never expose the raw text of a mixed clause: it may embed a separate deploy-only duty.
  const locator = (row) => ({
    legalUnitId: row.legalUnitId,
    documentNumber: row.documentNumber,
    canonicalLocator: row.canonicalLocator,
    sourceQuoteRequiredFromPinnedVersion: true,
    humanReviewRequired: true,
  });
  const developmentCandidates = buckets.DEVELOPMENT_CANDIDATE.map(locator);
  const mixedNeedsAtomization = buckets.SPLIT_DEV_AND_NONDEV.map(locator);
  const retainedIds = new Set(
    developmentCandidates.map((row) => row.legalUnitId),
  );
  const retainedMaterialContext = [];
  const seen = new Set();
  for (const link of materialLinks) {
    if (link?.reviewerStatus !== "APPROVED") continue;
    const context = units.get(link.contextLegalUnitId);
    const target = units.get(link.targetLegalUnitId);
    const key = [
      link.contextLegalUnitId,
      link.targetLegalUnitId,
      link.relationKind,
    ].join(":");
    if (
      !context ||
      !target ||
      context.stageTriage !== "CONTEXT_ONLY_IF_LINKED" ||
      !retainedIds.has(link.targetLegalUnitId) ||
      !RELATIONS.has(link.relationKind) ||
      !NODE_ID.test(link.sourceNodeId ?? "") ||
      !NODE_ID.test(link.targetSourceNodeId ?? "") ||
      link.sourceNodeId !== context.sourceNodeId ||
      link.targetSourceNodeId !== target.sourceNodeId ||
      !link.pinnedLegalSourceVersionId ||
      context.pinnedLegalSourceVersionId !== link.pinnedLegalSourceVersionId ||
      target.pinnedLegalSourceVersionId !== link.pinnedLegalSourceVersionId ||
      typeof link.materialPredicate !== "string" ||
      link.materialPredicate.length < 5 ||
      link.materialPredicate.length > 500 ||
      !context.sourceText?.includes(link.materialPredicate) ||
      !link.reviewerId?.trim() ||
      seen.has(key)
    ) {
      throw new Error(
        "Material context requires verified pinned nodes and directed reviewer approval",
      );
    }
    seen.add(key);
    retainedMaterialContext.push({
      contextLegalUnitId: link.contextLegalUnitId,
      targetLegalUnitId: link.targetLegalUnitId,
      sourceNodeId: link.sourceNodeId,
      targetSourceNodeId: link.targetSourceNodeId,
      pinnedLegalSourceVersionId: link.pinnedLegalSourceVersionId,
      relationKind: link.relationKind,
      materialPredicate: link.materialPredicate,
      reviewerId: link.reviewerId,
    });
  }
  return {
    documentType: "DEVELOPMENT_ONLY_REVIEW_VIEW",
    status: "REVIEW_ONLY_NOT_ACTIVATABLE",
    targetScope: "DEVELOPMENT_ONLY",
    activationEligible: false,
    counts: {
      totalSourceUnitsInSeparateFullSourceLedger: units.size,
      developmentCandidates: developmentCandidates.length,
      mixedNeedsAtomization: mixedNeedsAtomization.length,
      nonDevelopmentUnitsSuppressed: buckets.EXCLUDE_FROM_DEV_CATALOG.length,
      unrelatedContextSuppressed:
        buckets.CONTEXT_ONLY_IF_LINKED.length -
        new Set(retainedMaterialContext.map((x) => x.contextLegalUnitId)).size,
      unresolvedUnitsSuppressed: buckets.LEGAL_REVIEW_REQUIRED.length,
      approvedMaterialContext: retainedMaterialContext.length,
    },
    developmentCandidates,
    mixedNeedsAtomization,
    retainedMaterialContext,
    provenanceNote:
      "Review only. No raw source quotations from excluded deployment law units; authoritative full-source accounting is unchanged.",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path =
    process.argv[2] ??
    "docs/RULE_SET_PREPARATION_DEVELOPMENT_SCOPE_TRIAGE_VI.json";
  process.stdout.write(
    JSON.stringify(
      buildDevelopmentReviewView(JSON.parse(readFileSync(path, "utf8"))),
      null,
      2,
    ) + "\n",
  );
}
