import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  CITATION_SET_VALIDITY,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ValidateCitationSetHandler } from "./validate-citation-set.handler.js";
import { ValidateCitationSetQuery } from "./validate-citation-set.query.js";

function createHandler(input?: {
  assessment?: object | null;
  corpus?: object | null;
  match?: object | null;
  chunks?: object[];
}) {
  const prisma = {
    assessment: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.assessment === undefined
            ? { id: "assessment-1" }
            : input.assessment,
        ),
    },
    legalCorpusVersion: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.corpus === undefined ? { id: "corpus-1" } : input.corpus,
        ),
    },
    legalRuleMatch: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.match === undefined
            ? { id: "match-1", citationAllowlist: ["citation:chunk_active1"] }
            : input.match,
        ),
    },
    legalDocumentChunk: {
      findMany: jest
        .fn<() => Promise<object[]>>()
        .mockResolvedValue(input?.chunks ?? [activeChunk("chunk_active1")]),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new ValidateCitationSetHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    write,
  };
}

function query(citationRefs = ["citation:chunk_active1"]) {
  return new ValidateCitationSetQuery(
    "assessment-1",
    {
      corpusVersionId: "corpus_corpus-1",
      legalRuleMatchId: "legal_rule_match_match-1",
      citationRefs,
    },
    "user-1",
    "correlation-1",
  );
}

function activeChunk(
  id: string,
  input?: { legalStatus?: string; sourceEffectStatus?: string },
) {
  return {
    id,
    legalStatus: input?.legalStatus ?? "ACTIVE",
    sourceDocument: {
      sourceEffectStatus: input?.sourceEffectStatus ?? "CON_HIEU_LUC",
    },
  };
}

describe("ValidateCitationSetHandler", () => {
  it("TC-01: validates a sorted allow-listed effective citation set and records safe audit metadata", async () => {
    const { handler, write } = createHandler({
      match: {
        id: "match-1",
        citationAllowlist: ["citation:chunk_b", "citation:chunk_a"],
      },
      chunks: [activeChunk("chunk_b"), activeChunk("chunk_a")],
    });

    const response = await handler.execute(
      query(["citation:chunk_b", "citation:chunk_a"]),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.valid).toBe(true);
    expect(response.result.items.map(({ citationRef }) => citationRef)).toEqual(
      ["citation:chunk_a", "citation:chunk_b"],
    );
    expect(JSON.stringify(write.mock.calls)).toContain("citationRefHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain(
      "sourceEffectStatus",
    );
  });

  it("TC-03: distinguishes absent, repealed, and out-of-allowlist citations without treating any as valid", async () => {
    const { handler } = createHandler({
      match: { id: "match-1", citationAllowlist: ["citation:chunk_repealed"] },
      chunks: [
        activeChunk("chunk_repealed", { legalStatus: "REPEALED" }),
        activeChunk("chunk_other"),
      ],
    });

    const response = await handler.execute(
      query([
        "citation:chunk_missing",
        "citation:chunk_repealed",
        "citation:chunk_other",
      ]),
    );

    expect(response.result.valid).toBe(false);
    expect(response.result.items.map(({ validity }) => validity)).toEqual([
      CITATION_SET_VALIDITY.absent,
      CITATION_SET_VALIDITY.outOfAllowlist,
      CITATION_SET_VALIDITY.repealed,
    ]);
  });

  it("TC-04: fails closed when the caller cannot access the accepted pinned rule match", async () => {
    const { handler } = createHandler({ match: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.result.items).toEqual([]);
  });

  it("TC-05: does not resolve a corpus when assessment ownership fails", async () => {
    const { handler } = createHandler({ assessment: null });
    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
