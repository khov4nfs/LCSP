import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import {
  AGENTIC_TOOL_STATUSES,
  LEGAL_BASIS_CONTEXT_ROLES,
  LEGAL_BASIS_RETRIEVAL_VALUES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RetrieveLegalBasisHandler } from "./retrieve-legal-basis.handler.js";
import { RetrieveLegalBasisQuery } from "./retrieve-legal-basis.query.js";

const HASH =
  "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1";

function createHandler(input?: {
  assessment?: object | null;
  corpus?: object | null;
  index?: object | null;
  indexError?: Error;
  rules?: object[];
  chunks?: Record<string, object>;
}) {
  const assessmentFindFirst = jest
    .fn<() => Promise<object | null>>()
    .mockResolvedValue(
      input?.assessment === undefined
        ? { id: "assessment-1" }
        : input.assessment,
    );
  const corpusFindFirst = jest
    .fn<() => Promise<object | null>>()
    .mockResolvedValue(
      input?.corpus === undefined ? { id: "corpus-1" } : input.corpus,
    );
  const indexFindFirst = input?.indexError
    ? jest
        .fn<() => Promise<object | null>>()
        .mockRejectedValue(input.indexError)
    : jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.index === undefined
            ? validIndex({ id: "index-1" })
            : input.index,
        );
  const legalRuleFindMany = jest
    .fn<() => Promise<object[]>>()
    .mockResolvedValue(input?.rules ?? []);
  const legalDocumentChunkFindMany = jest.fn(
    (args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        args.where.id.in
          .map((id) => input?.chunks?.[id])
          .filter((chunk): chunk is object => Boolean(chunk)),
      ),
  );
  const prisma = {
    assessment: { findFirst: assessmentFindFirst },
    legalCorpusVersion: { findFirst: corpusFindFirst },
    legalRetrievalIndex: { findFirst: indexFindFirst },
    legalRule: { findMany: legalRuleFindMany },
    legalDocumentChunk: { findMany: legalDocumentChunkFindMany },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new RetrieveLegalBasisHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    corpusFindFirst,
    indexFindFirst,
    legalRuleFindMany,
    legalDocumentChunkFindMany,
    write,
  };
}

function query(
  input?: Partial<ConstructorParameters<typeof RetrieveLegalBasisQuery>[1]>,
) {
  return new RetrieveLegalBasisQuery(
    "assessment-1",
    {
      corpusVersionId: "corpus_corpus-1",
      selectors: { chunkIds: ["chunk_primary1"] },
      includeContext: true,
      ...input,
    },
    "user-1",
    "correlation-1",
  );
}

function validIndex(input: { id: string }) {
  return {
    ...input,
    configHash: HASH,
    contentHash: HASH,
    validationManifestRef: "retrieval-validation:index-1",
  };
}

function chunk(input: {
  id: string;
  locator: string;
  content?: string;
  legalStatus?: string;
  hierarchy?: object;
  sourceEffectStatus?: string;
}) {
  return {
    id: input.id,
    locator: input.locator,
    content: input.content ?? "Approved legal excerpt.",
    contentSha256: HASH,
    legalStatus: input.legalStatus ?? "ACTIVE",
    hierarchy: input.hierarchy ?? {},
    sourceDocument: {
      sourceEffectStatus: input.sourceEffectStatus ?? "CON_HIEU_LUC",
      sourceUrl: "https://official.example/private-metadata",
    },
  };
}

describe("RetrieveLegalBasisHandler", () => {
  it("TC-01: returns deterministic primary, parent, and one-hop reference citations from a pinned validated corpus", async () => {
    const { handler, write, legalRuleFindMany } = createHandler({
      rules: [
        {
          citationLocatorRefs: [{ id: "chunk_primary1" }],
          rawPrompt: "must never leak",
        },
      ],
      chunks: {
        chunk_primary1: chunk({
          id: "chunk_primary1",
          locator: "Article 12(1)",
          content: "A".repeat(900),
          hierarchy: {
            parentChunkId: "chunk_parent1",
            outgoingRefIds: ["chunk_related1"],
          },
        }),
        chunk_parent1: chunk({ id: "chunk_parent1", locator: "Article 12" }),
        chunk_related1: chunk({ id: "chunk_related1", locator: "Article 19" }),
      },
    });

    const response = await handler.execute(
      query({ selectors: { ruleIds: ["rule_alpha1"] } }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.outcome).toBe(LEGAL_BASIS_RETRIEVAL_VALUES.matched);
    expect(
      response.result.citations.map(({ contextRole }) => contextRole),
    ).toEqual([
      LEGAL_BASIS_CONTEXT_ROLES.primaryMatch,
      LEGAL_BASIS_CONTEXT_ROLES.parentContext,
      LEGAL_BASIS_CONTEXT_ROLES.referencedContext,
    ]);
    expect(response.result.citations[0]?.excerpt).toHaveLength(800);
    expect(JSON.stringify(response)).not.toContain("official.example");
    expect(JSON.stringify(response)).not.toContain("must never leak");
    expect(JSON.stringify(write.mock.calls)).not.toContain("official.example");
    expect(legalRuleFindMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(write.mock.calls)).toContain("selectorHash");
    expect(JSON.stringify(write.mock.calls)).toContain("outputHash");
  });

  it("TC-03: distinguishes a non-effective selected chunk from an exhaustive exact miss", async () => {
    const { handler } = createHandler({
      chunks: {
        chunk_primary1: chunk({
          id: "chunk_primary1",
          locator: "Article 12(1)",
          legalStatus: "REPEALED",
        }),
      },
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.result.outcome).toBe(LEGAL_BASIS_RETRIEVAL_VALUES.notFound);
    expect(response.limitations[0]?.code).toBe(
      "NO_EFFECTIVE_CHUNK_FOR_SELECTOR",
    );
  });

  it("TC-02: returns a safe ready/not-found result when exact selectors do not exist", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result).toEqual({
      outcome: LEGAL_BASIS_RETRIEVAL_VALUES.notFound,
      citations: [],
      nextCursor: null,
    });
  });

  it("TC-04: fails closed before corpus retrieval for an inaccessible assessment", async () => {
    const { handler, corpusFindFirst } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(corpusFindFirst).not.toHaveBeenCalled();
  });

  it("TC-06: retries a transient index outage once and returns no stack or query content", async () => {
    const { handler, indexFindFirst, write } = createHandler({
      indexError: new Error("database host and private query must not leak"),
    });

    const response = await handler.execute(query());

    expect(indexFindFirst).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.failed);
    expect(JSON.stringify(response)).not.toContain("database host");
    expect(JSON.stringify(write.mock.calls)).not.toContain("private query");
  });
});
