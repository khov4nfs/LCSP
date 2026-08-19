import type { LegalProvisionDisplayDto } from "../contracts/assessment/assessment-detail.contract.js";

type LegalChunkDisplaySource = {
  id: string;
  documentId: string;
  locator: string;
  content: string;
  hierarchy: unknown;
};

type JsonRecord = Record<string, unknown>;

export function resolveLegalProvisionDisplays(
  sourceChunkIds: string[],
  chunks: LegalChunkDisplaySource[],
): LegalProvisionDisplayDto[] {
  const requestedOrder = new Map(
    sourceChunkIds.map((id, index) => [id, index] as const),
  );
  const unique = new Map<string, LegalChunkDisplaySource>();

  for (const chunk of chunks) {
    if (!requestedOrder.has(chunk.id)) continue;
    const key = `${chunk.documentId}::${chunk.locator}`;
    if (!unique.has(key)) unique.set(key, chunk);
  }

  const candidates = Array.from(unique.values()).sort(
    (left, right) =>
      (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );

  const mostSpecific = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.documentId === candidate.documentId &&
          isDescendantLocator(other.locator, candidate.locator),
      ),
  );

  return mostSpecific.map(toDisplay);
}

function isDescendantLocator(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}::`);
}

function toDisplay(chunk: LegalChunkDisplaySource): LegalProvisionDisplayDto {
  const hierarchy = asRecord(chunk.hierarchy) ?? {};
  return {
    document_id: chunk.documentId,
    locator: chunk.locator,
    article_number:
      text(hierarchy.articleNumber) ?? locatorPart(chunk.locator, "art"),
    clause_number:
      text(hierarchy.clauseNumber) ?? locatorPart(chunk.locator, "cl"),
    point_code: text(hierarchy.pointCode) ?? locatorPart(chunk.locator, "pt"),
    content: normalizeContent(chunk.content),
  };
}

function locatorPart(locator: string, prefix: string): string | null {
  for (const segment of locator.split("::")) {
    const match = new RegExp(`^${prefix}-(.+)$`, "i").exec(segment);
    if (match?.[1]) return match[1];
  }
  return null;
}

function normalizeContent(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
