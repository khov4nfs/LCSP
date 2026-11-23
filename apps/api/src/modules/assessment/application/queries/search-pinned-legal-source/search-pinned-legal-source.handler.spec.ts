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
  const findUniqueOrThrow = jest
    .fn<(args: unknown) => Promise<{ legalSourceVersionId: string }>>()
    .mockResolvedValue({ legalSourceVersionId: SOURCE_VERSION });
  const tx = {
    complianceRuleSetVersion: {
      findUniqueOrThrow,
    },
    legalDocumentChunk: { findMany },
  };
  const authorizeInTx = jest
    .fn<(client: typeof tx, input: unknown) => Promise<Record<string, never>>>()
    .mockResolvedValue({});
  const loadPins = jest
    .fn<
      (
        client: typeof tx,
        assessmentId: string,
        correlationId: string,
      ) => Promise<{ ruleSetVersionId: string }>
    >()
    .mockResolvedValue({ ruleSetVersionId: "rs" });
  const handler = new SearchPinnedLegalSourceHandler(
    {
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaService,
    {
      authorizeInTx,
    } as unknown as AssessmentRuntimeAuthority,
    {
      loadPins,
    } as unknown as AssessmentCaseSupport,
  );
  return {
    handler,
    tx,
    findMany,
    findUniqueOrThrow,
    authorizeInTx,
    loadPins,
  };
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

  it("[RED][ASM-LEGAL-01] deduplicates legal search terms case-insensitively", () => {
    // PostgreSQL matching is case-insensitive on this path, so duplicate terms
    // that differ only by case must not create redundant AND predicates.
    expect(searchTermsOf("Register register REGISTER keeper")).toEqual([
      "register",
      "keeper",
    ]);
  });

  it("normalizes Unicode compatibility forms before filtering and deduplication", () => {
    // Full-width Latin text and the Kelvin sign are compatibility-equivalent
    // to their ASCII forms, while the single-code-point ligature expands first.
    expect(searchTermsOf("Ｒｅｇｉｓｔｅｒ Register KEEPER keeper ﬀ")).toEqual([
      "register",
      "keeper",
      "ff",
    ]);
  });

  it("applies the term limit after canonical duplicates are removed", () => {
    expect(
      searchTermsOf(
        "Register register REGISTER keeper controller processor operator auditor custodian",
      ),
    ).toEqual([
      "register",
      "keeper",
      "controller",
      "processor",
      "operator",
      "auditor",
    ]);
  });

  it("uses deterministic Unicode casing instead of the host locale", () => {
    const localeLowerCase = jest.spyOn(String.prototype, "toLocaleLowerCase");

    expect(searchTermsOf("TITLE TİTLE title")).toEqual(["title", "ti̇tle"]);
    expect(localeLowerCase).not.toHaveBeenCalled();

    localeLowerCase.mockRestore();
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

  it("builds one canonical AND predicate per logical term under the pinned source", async () => {
    const { handler, findMany, findUniqueOrThrow, loadPins, tx } = build([]);

    await handler.execute(
      search("Ｒｅｇｉｓｔｅｒ Register REGISTER KEEPER keeper"),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          legalSourceVersionId: SOURCE_VERSION,
          AND: [
            { content: { contains: "register", mode: "insensitive" } },
            { content: { contains: "keeper", mode: "insensitive" } },
          ],
        },
      }),
    );
    expect(loadPins).toHaveBeenCalledWith(tx, "assessment-1", "correlation");
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "rs" },
      select: { legalSourceVersionId: true },
    });
  });

  it("returns no match, and reads nothing, for a query without usable terms", async () => {
    const { handler, authorizeInTx, findMany, tx } = build([]);
    expect(searchTermsOf("a")).toEqual([]);
    expect(await handler.execute(search(" \u3000\t\n"))).toEqual({
      matches: [],
      truncated: false,
    });
    expect(authorizeInTx).toHaveBeenCalledWith(tx, {
      assessmentId: "assessment-1",
      leaseToken: "lease",
      correlationId: "correlation",
      requireActive: false,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates authorization and pin failures before searching legal chunks", async () => {
    const unauthorized = build([]);
    const authorizationError = new Error("invalid lease");
    unauthorized.authorizeInTx.mockRejectedValueOnce(authorizationError);

    await expect(unauthorized.handler.execute(search("register"))).rejects.toBe(
      authorizationError,
    );
    expect(unauthorized.loadPins).not.toHaveBeenCalled();
    expect(unauthorized.findMany).not.toHaveBeenCalled();

    const missingPins = build([]);
    const pinError = new Error("pins unavailable");
    missingPins.loadPins.mockRejectedValueOnce(pinError);

    await expect(missingPins.handler.execute(search("register"))).rejects.toBe(
      pinError,
    );
    expect(missingPins.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(missingPins.findMany).not.toHaveBeenCalled();
  });
});
