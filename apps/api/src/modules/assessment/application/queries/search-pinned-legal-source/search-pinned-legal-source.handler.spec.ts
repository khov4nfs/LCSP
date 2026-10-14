import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  SearchPinnedLegalSourceHandler,
  searchTermsOf,
  snippetAround,
} from "./search-pinned-legal-source.handler.js";
import { SearchPinnedLegalSourceQuery } from "./search-pinned-legal-source.query.js";

const SOURCE_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function build(rows: Array<Record<string, string>>) {
  const findMany = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve(rows);
  });
  const tx = {
    complianceRuleSetVersion: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({ legalSourceVersionId: SOURCE_VERSION }),
      ),
    },
    legalDocumentChunk: { findMany },
  };
  const handler = new SearchPinnedLegalSourceHandler(
    {
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaService,
    {
      authorizeInTx: jest.fn(() => Promise.resolve({})),
    } as unknown as AssessmentRuntimeAuthority,
    {
      loadPins: jest.fn(() => Promise.resolve({ ruleSetVersionId: "rs" })),
    } as unknown as AssessmentCaseSupport,
  );
  return { handler, findMany };
}

const search = (text: string) =>
  new SearchPinnedLegalSourceQuery(
    "assessment-1",
    "lease",
    text,
    "correlation",
  );

describe("Pinned legal source keyword search", () => {
  it("splits the query into bounded, deduplicated terms", () => {
    expect(searchTermsOf("  register  keeper register a ")).toEqual([
      "register",
      "keeper",
    ]);
    expect(searchTermsOf("a b c d e f g h i j k l").length).toBeLessThanOrEqual(
      6,
    );
  });

  it("builds a snippet around the first matching term", () => {
    const content = `${"x".repeat(400)} the keeper of a register ${"y".repeat(400)}`;
    const snippet = snippetAround(content, ["register"]);
    expect(snippet).toContain("keeper of a register");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(400);
  });

  it("requires every term, only inside the pinned source version, and flags truncation", async () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({
      documentId: "DOC-1",
      locator: `art-${index}`,
      contentSha256: "sha256:" + "b".repeat(64),
      content: `The keeper of the register ${index}`,
    }));
    const { handler, findMany } = build(rows);

    const result = await handler.execute(search("keeper register"));

    expect(result.matches).toHaveLength(15);
    expect(result.truncated).toBe(true);
    const where = (
      findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(where.legalSourceVersionId).toBe(SOURCE_VERSION);
    expect(where.AND).toHaveLength(2);
  });

  it("returns no match, and reads nothing, for a query without usable terms", async () => {
    const { handler, findMany } = build([]);
    expect(await handler.execute(search("a"))).toEqual({
      matches: [],
      truncated: false,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
