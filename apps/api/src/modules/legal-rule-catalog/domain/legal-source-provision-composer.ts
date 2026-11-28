import { Prisma, LegalEffectStatus } from "@prisma/client";
import {
  LEGAL_RULE_SOURCE_PROVISION_LEVELS,
  LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS,
  type LegalRuleSourceProvision,
  type LegalRuleSourceProvisionLimitation,
} from "@lcsp/contracts/legal-rule-catalog";
import { sha256Hex } from "../../assessment/domain/domain-ids.js";

export type SourceProvisionChunk = {
  id: string;
  documentId: string;
  locator: string;
  content: string;
  contentSha256: string;
  hierarchy: Prisma.JsonValue;
  legalEffectStatus: LegalEffectStatus;
};

/**
 * Business purpose: Compare source lines for exact duplicate suppression.
 * Business rules:
 * - Comparison normalization must never alter wording emitted in a LegalRule description.
 * Execution flow:
 * 1. Build a comparison key from Unicode-normalized, whitespace-collapsed source text.
 * Failure cases:
 * - Empty text produces an empty comparison key.
 * Side effects:
 * - Pure string normalization; source wording is unchanged.
 */
export const normalizeSourceLine = (value: string) =>
  value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("vi-VN");

/**
 * Business purpose: Normalize transport part suffixes to the logical provision identity.
 * Business rules:
 * - Ignore only the trailing persisted part marker; preserve every legal hierarchy segment.
 * Execution flow:
 * 1. Remove one recognized part suffix and return the logical locator.
 * Failure cases:
 * - Unrecognized suffixes remain part of the locator for the provision parser to reject.
 * Side effects:
 * - Pure string normalization; source rows are unchanged.
 */
export const baseLocator = (locator: string) =>
  locator.replace(/::part-\d+$/u, "");

/**
 * Business purpose: Read source hierarchy metadata without trusting malformed JSON shapes.
 * Business rules:
 * - Only a non-array JSON object may supply Article, Clause, or Point metadata.
 * Execution flow:
 * 1. Validate the stored value's object shape and return its fields when valid.
 * Failure cases:
 * - Non-object metadata produces an empty hierarchy and is handled as unresolved downstream.
 * Side effects:
 * - Pure in-memory projection; no persisted hierarchy is changed.
 */
export const readHierarchy = (chunk: SourceProvisionChunk): Record<string, unknown> =>
  chunk.hierarchy &&
  typeof chunk.hierarchy === "object" &&
  !Array.isArray(chunk.hierarchy)
    ? (chunk.hierarchy as Record<string, unknown>)
    : {};

/**
 * Business purpose: Accept only Article–Clause–Point locator paths for provision composition.
 * Business rules:
 * - Structural-only and unstructured locator families are never accepted as legal leaves.
 * Execution flow:
 * 1. Remove transport suffixes and parse supported Article-Clause-Point segments.
 * Failure cases:
 * - Invalid order, unsupported depth, and malformed segments return null for unresolved review.
 * Side effects:
 * - Pure locator parsing; no source identity is rewritten.
 */
export const parseProvisionLocator = (locator: string) => {
  const identityLocator = baseLocator(locator);
  const structuralLocator = identityLocator.replace(/::dup-\d+$/u, "");
  const segments = structuralLocator.split("::");
  if (
    segments.length < 1 ||
    segments.length > 3 ||
    !/^art-[\p{L}\d._-]+$/u.test(segments[0]) ||
    (segments.length >= 2 && !/^cl-[\p{L}\d._-]+$/u.test(segments[1])) ||
    (segments.length === 3 && !/^pt-[\p{L}\d._-]+$/u.test(segments[2]))
  )
    return null;
  return { identityLocator, segments };
};

/**
 * Business purpose: Convert validated hierarchy primitives to display text without coercing malformed JSON into legal prose.
 * Business rules:
 * - Narrative hierarchy fields accept strings only; Article and Clause numbers may also be finite numbers.
 * - Objects, arrays, booleans, and non-finite numbers are invalid context and must remain unresolved.
 * Execution flow:
 * 1. Trim string values and return them unchanged otherwise.
 * 2. Convert finite numeric identifiers only when the field permits numeric values.
 * 3. Return null for malformed values so the caller can surface a typed limitation.
 * Failure cases:
 * - Unsupported JSON values return null and are not stringified into a LegalRule description.
 * Side effects:
 * - Pure validation and formatting of an in-memory hierarchy value.
 */
export const hierarchyText = (
  value: unknown,
  allowNumber: boolean,
): string | null => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (allowNumber && typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
};

type SourceGroup = {
  identityLocator: string;
  segments: string[];
  chunks: SourceProvisionChunk[];
  hierarchy: Record<string, unknown>;
};

/**
 * Business purpose: Distinguish a parent's own enforceable text from a heading or child setup lead-in.
 * Business rules:
 * - Explicit chunker metadata is authoritative; otherwise the parent needs residual body text beyond its heading and setup lead-in.
 * - A trailing setup colon alone is not treated as an independent obligation.
 * Execution flow:
 * 1. Require an existing, EFFECTIVE parent chunk.
 * 2. Check the independent-substance marker, then compare body lines with hierarchy heading and lead-in metadata.
 * Failure cases:
 * - Missing or non-effective parent chunks cannot establish independent legal content.
 * Side effects:
 * - Pure classification of persisted source text; no parent content is copied or changed.
 */
export const hasIndependentParentContent = (
  group: SourceGroup | undefined,
  heading: string,
  leadIn: string,
): boolean => {
  if (
    !group ||
    !group.chunks.length ||
    group.chunks.some(
      (chunk) => chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE,
    )
  )
    return false;
  if (group.hierarchy.independentlySubstantive === true) return true;
  const metadataLines = new Set(
    [heading, ...leadIn.split(/\r?\n/u)].map(normalizeSourceLine).filter(Boolean),
  );
  const residual = group.chunks
    .flatMap((chunk) => chunk.content.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const key = normalizeSourceLine(line);
      if (metadataLines.has(key)) return false;
      if (leadIn && key.endsWith(normalizeSourceLine(leadIn))) return false;
      return true;
    });
  const leadInLines = leadIn.split(/\r?\n/u).map((line) => line.trim());
  const hasPriorSentence =
    leadInLines.slice(0, -1).some((line) => /[.;?!]$/u.test(line)) ||
    /[.;?!]\s+\S/u.test(leadIn);
  if (leadIn.trim().endsWith(":") && hasPriorSentence) return true;
  return residual.length > 0 && !leadIn.trim().endsWith(":");
};

/**
 * Business purpose: Project eligible Article–Clause–Point leaf provisions with their exact applicable parent context for source import.
 * Business rules:
 * - Only EFFECTIVE Article, Clause or Point chunks with a classified hierarchy can become source rules.
 * - A parent with descendants is selectable only when its own chunk contains provision text beyond its structural heading and setup lead-in.
 * - Parent headings and lead-ins come from metadata; independently substantive parent chunks remain distinct selectable rules.
 * - Exact EFFECTIVE ancestor chunks are included as context for the selected provision. Siblings, unrelated provisions and non-effective ancestor groups are excluded.
 * - Split chunks collapse to one logical provision while each persisted part remains an exact citation reference.
 * Execution flow:
 * 1. Group eligible persisted chunk parts by their locator without the transport-only part suffix.
 * 2. Determine descendants and retain only legal leaves or explicitly substantive parent provisions.
 * 3. Compose recorded Article heading/lead-in, Clause heading/lead-in and the selected leaf in reading order with exact line de-duplication.
 * 4. Cite the selected provision and its effective ancestors within the existing bound; return the stable identity and context limitations.
 * Failure cases:
 * - Unclassified and malformed-locator chunks are omitted; non-effective and context-incomplete provisions are returned as typed limitations, never treated as eligible or silently presented as absent.
 * Side effects:
 * - None: this deterministic projection reads immutable source rows and creates no LegalRule or source mutation.
 */
export function composeLegalSourceProvisions(input: {
  sourceVersionId: string;
  documentId: string;
  documentTitle: string;
  chunks: SourceProvisionChunk[];
}): {
  items: LegalRuleSourceProvision[];
  limitations: LegalRuleSourceProvisionLimitation[];
} {
  const limitations: LegalRuleSourceProvisionLimitation[] = [];

  /**
   * Business purpose: Keep each unresolved source locator visible once in the projection response.
   * Business rules:
   * - A limitation is unique by source locator and typed reason so unresolved coverage stays concise.
   * Execution flow:
   * 1. Check whether the locator/reason pair already exists.
   * 2. Append the pair only when it is new.
   * Failure cases:
   * - Duplicate pairs are ignored; invalid typed reasons are rejected by the contract boundary.
   * Side effects:
   * - Mutates only this projection's in-memory limitation list.
   */
  const addLimitation = (
    locator: string,
    reason: LegalRuleSourceProvisionLimitation["reason"],
  ) => {
    if (
      !limitations.some(
        (item) => item.locator === locator && item.reason === reason,
      )
    )
      limitations.push({ locator, reason });
  };

  const groups = new Map<string, SourceGroup>();
  for (const chunk of input.chunks) {
    const parsed = parseProvisionLocator(chunk.locator);
    const hierarchy = readHierarchy(chunk);
    if (!parsed || hierarchy.structureClassification === "UNCLASSIFIED") {
      addLimitation(
        chunk.locator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.UNCLASSIFIED,
      );
      continue;
    }
    const group = groups.get(parsed.identityLocator) ?? {
      ...parsed,
      chunks: [],
      hierarchy,
    };
    group.chunks.push(chunk);
    groups.set(parsed.identityLocator, group);
  }

  const sourceGroups = [...groups.values()].sort((left, right) =>
    left.identityLocator.localeCompare(right.identityLocator, "en", {
      numeric: true,
    }),
  );
  const items: LegalRuleSourceProvision[] = [];

  /**
   * Business purpose: Reassemble exact persisted text parts for one logical provision.
   * Business rules:
   * - Part order follows persisted locator order and original non-empty source wording is retained.
   * Execution flow:
   * 1. Sort the stored parts, trim only their outer whitespace, and join them with line breaks.
   * Failure cases:
   * - Missing groups produce empty text; source content is never reconstructed.
   * Side effects:
   * - Pure in-memory projection of persisted content.
   */
  const contentOf = (group: SourceGroup | undefined) =>
    group?.chunks
      .slice()
      .sort((left, right) =>
        left.locator.localeCompare(right.locator, "en", { numeric: true }),
      )
      .map((chunk) => chunk.content.trim())
      .filter(Boolean)
      .join("\n") ?? "";

  for (const group of sourceGroups) {
    if (
      group.chunks.some(
        (chunk) => chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE,
      )
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.EFFECT_NOT_EFFECTIVE,
      );
      continue;
    }
    const hasDescendant = sourceGroups.some(
      (candidate) =>
        candidate.segments.length > group.segments.length &&
        group.segments.every(
          (segment, index) => candidate.segments[index] === segment,
        ),
    );
    const articleNumberValue = hierarchyText(
      group.hierarchy.articleNumber,
      true,
    );
    const articleTitle = hierarchyText(group.hierarchy.articleTitle, false);
    const articleHeadingValue = hierarchyText(
      group.hierarchy.articleHeading,
      false,
    );
    const articleLeadIn = hierarchyText(group.hierarchy.articleLeadIn, false);
    const clauseNumberValue = hierarchyText(group.hierarchy.clauseNumber, true);
    const clauseNumberingValue = hierarchyText(
      group.hierarchy.clauseNumbering,
      false,
    );
    const clauseHeadingValue = hierarchyText(
      group.hierarchy.clauseHeading,
      false,
    );
    const clauseLeadIn = hierarchyText(group.hierarchy.clauseLeadIn, false);
    if (
      articleNumberValue === null ||
      articleTitle === null ||
      articleHeadingValue === null ||
      articleLeadIn === null ||
      clauseNumberValue === null ||
      clauseNumberingValue === null ||
      clauseHeadingValue === null ||
      clauseLeadIn === null
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_UNRESOLVED,
      );
      continue;
    }
    const articleNumber =
      articleNumberValue || group.segments[0]?.slice("art-".length) || "";
    const clauseNumber =
      clauseNumberValue || group.segments[1]?.slice("cl-".length) || "";
    const articleHeading =
      articleHeadingValue ||
      (articleNumber
        ? `Điều ${articleNumber}.${articleTitle ? ` ${articleTitle}` : ""}`
        : "");
    const clauseNumbering =
      clauseNumberingValue || (clauseNumber ? `${clauseNumber}.` : "");
    const clauseHeading = clauseHeadingValue || clauseNumbering;
    const articleParent = sourceGroups.find(
      (candidate) =>
        candidate.segments.length === 1 &&
        candidate.identityLocator === group.segments[0],
    );
    const clauseLocator =
      group.segments.length >= 2 ? group.segments.slice(0, 2).join("::") : "";
    const clauseParent = clauseLocator
      ? sourceGroups.find(
          (candidate) =>
            candidate.segments.length === 2 &&
            candidate.identityLocator === clauseLocator,
        )
      : undefined;
    const independentArticle = hasIndependentParentContent(
      articleParent,
      articleHeading,
      articleLeadIn,
    );
    const independentClause = hasIndependentParentContent(
      clauseParent,
      clauseHeading,
      clauseLeadIn,
    );
    if (
      hasDescendant &&
      !(group.segments.length === 1 ? independentArticle : independentClause)
    )
      continue;

    const sourceContent = contentOf(group);
    const ownHeading =
      group.segments.length === 1 ? articleHeading : clauseNumbering;
    if (
      !hasDescendant &&
      group.segments.length < 3 &&
      ownHeading &&
      sourceContent
        .split(/\r?\n/u)
        .map(normalizeSourceLine)
        .filter(Boolean)
        .every((line) => line === normalizeSourceLine(ownHeading))
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.STRUCTURAL_ONLY,
      );
      continue;
    }

    const clauseLeadInLines = clauseLeadIn.split(/\r?\n/u);
    const clauseHeadingBody = clauseHeading.replace(/^\s*\d+[.)]\s*/u, "");
    const remainingClauseLeadIn =
      clauseLeadInLines.length > 0 &&
      normalizeSourceLine(clauseLeadInLines[0]) === normalizeSourceLine(clauseHeadingBody)
        ? clauseLeadInLines.slice(1).join("\n")
        : clauseLeadIn;
    const clauseContext = [clauseHeading, remainingClauseLeadIn];
    const sourceLineKeys = new Set(
      sourceContent.split(/\r?\n/u).map(normalizeSourceLine).filter(Boolean),
    );
    const contextLines: string[] = [];
    const contextKeys = new Set<string>();
    for (const value of [
      articleHeading,
      group.segments.length >= 2 && independentArticle ? "" : articleLeadIn,
      ...(group.segments.length >= 2
        ? group.segments.length === 3
          ? independentClause
            ? [clauseNumbering]
            : [clauseHeading, remainingClauseLeadIn]
          : clauseContext
        : []),
      sourceContent,
    ]) {
      for (const line of value.split(/\r?\n/u)) {
        const trimmed = line.trim();
        const key = normalizeSourceLine(trimmed);
        if (trimmed && !sourceLineKeys.has(key) && !contextKeys.has(key)) {
          contextLines.push(trimmed);
          contextKeys.add(key);
        }
      }
    }
    const description = [contextLines.join("\n"), sourceContent.trim()]
      .filter(Boolean)
      .join("\n")
      .trim();
    const contextResolved =
      (group.segments.length === 1 || Boolean(articleHeading)) &&
      (group.segments.length < 3 || Boolean(clauseHeading));
    if (!contextResolved) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_UNRESOLVED,
      );
      continue;
    }
    const citationChunks = [...group.chunks];
    for (const parent of [clauseParent, articleParent]) {
      if (
        parent &&
        parent !== group &&
        parent.chunks.every(
          (chunk) => chunk.legalEffectStatus === LegalEffectStatus.EFFECTIVE,
        )
      )
        citationChunks.push(...parent.chunks);
    }
    if (description.length > 12000 || citationChunks.length > 64) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_TOO_LARGE,
      );
      continue;
    }
    const citationLocatorRefs = citationChunks.map((chunk) => ({
      documentId: chunk.documentId,
      locator: chunk.locator,
    }));
    const level =
      group.segments.length === 1
        ? LEGAL_RULE_SOURCE_PROVISION_LEVELS.ARTICLE
        : group.segments.length === 2
          ? LEGAL_RULE_SOURCE_PROVISION_LEVELS.CLAUSE
          : LEGAL_RULE_SOURCE_PROVISION_LEVELS.POINT;
    const legalRuleId = `src-${sha256Hex(`${input.sourceVersionId}::${input.documentId}::${group.identityLocator}`)}`;
    items.push({
      sourceVersionId: input.sourceVersionId,
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      locator: group.identityLocator,
      legalRuleId,
      title: `${input.documentTitle} - ${group.identityLocator}`.slice(0, 512),
      description,
      citationLocatorRefs,
      level,
    });
  }
  return { items, limitations };
}
