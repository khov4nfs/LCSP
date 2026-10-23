import {
  PINNED_LEGAL_SOURCE_SEARCH_LIMITS,
  pinnedLegalSourceSearchResultSchema,
  type PinnedLegalSourceSearchResult,
} from "@lcsp/contracts/assessment-domain";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { SearchPinnedLegalSourceQuery } from "./search-pinned-legal-source.query.js";

const { MAX_TERMS, MAX_RESULTS, SNIPPET_RADIUS } =
  PINNED_LEGAL_SOURCE_SEARCH_LIMITS;

/** Whitespace-separated terms, each at least two characters, deduplicated and bounded. */
export function searchTermsOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ].slice(0, MAX_TERMS);
}

export function snippetAround(
  content: string,
  terms: readonly string[],
): string {
  const lowered = content.toLowerCase();
  const at = terms
    .map((term) => lowered.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (at ?? 0) - SNIPPET_RADIUS);
  const end = Math.min(content.length, (at ?? 0) + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

/**
 * Keyword search over the Legal Source Version the assessment's pinned rule set was prepared
 * from. Every term must occur (case-insensitive); it is a way to find the provisions that define
 * or limit a term, never a ranking or an interpretation.
 */
@QueryHandler(SearchPinnedLegalSourceQuery)
export class SearchPinnedLegalSourceHandler implements IQueryHandler<SearchPinnedLegalSourceQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  async execute(
    input: SearchPinnedLegalSourceQuery,
  ): Promise<PinnedLegalSourceSearchResult> {
    const terms = searchTermsOf(input.text);
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      if (terms.length === 0) {
        return pinnedLegalSourceSearchResultSchema.parse({
          matches: [],
          truncated: false,
        });
      }
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const ruleSet = await tx.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: pins.ruleSetVersionId },
        select: { legalSourceVersionId: true },
      });
      const rows = await tx.legalDocumentChunk.findMany({
        where: {
          legalSourceVersionId: ruleSet.legalSourceVersionId,
          AND: terms.map((term) => ({
            content: { contains: term, mode: "insensitive" as const },
          })),
        },
        orderBy: [{ documentId: "asc" }, { locator: "asc" }],
        take: MAX_RESULTS + 1,
        select: {
          documentId: true,
          locator: true,
          contentSha256: true,
          content: true,
        },
      });
      return pinnedLegalSourceSearchResultSchema.parse({
        matches: rows.slice(0, MAX_RESULTS).map((row) => ({
          documentId: row.documentId,
          locator: row.locator,
          contentSha256: row.contentSha256,
          snippet: snippetAround(row.content, terms),
        })),
        truncated: rows.length > MAX_RESULTS,
      });
    });
  }
}
