import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import {
  AGENTIC_TOOL_STATUSES,
  LEGAL_CORPUS_READINESS_REQUIREMENTS,
  LEGAL_CORPUS_READINESS_VALUES,
} from "@lcsp/contracts/evidence";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetLegalCorpusReadinessHandler } from "./get-legal-corpus-readiness.handler.js";
import { GetLegalCorpusReadinessQuery } from "./get-legal-corpus-readiness.query.js";

function createHandler(input?: {
  assessment?: object | null;
  corpus?: object | null;
  index?: object | null;
  indexError?: Error;
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
  const prisma = {
    assessment: { findFirst: assessmentFindFirst },
    legalCorpusVersion: { findFirst: corpusFindFirst },
    legalRetrievalIndex: { findFirst: indexFindFirst },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const audit = { write } as unknown as AuditWriterService;
  return {
    handler: new GetLegalCorpusReadinessHandler(prisma, audit),
    assessmentFindFirst,
    corpusFindFirst,
    indexFindFirst,
    write,
  };
}

function query(pinnedCorpusVersionId: string | null = null) {
  return new GetLegalCorpusReadinessQuery(
    "assessment-1",
    new Date("2026-08-12T00:00:00.000Z"),
    pinnedCorpusVersionId,
    "user-1",
    "correlation-1",
  );
}

function validIndex(input: { id: string }) {
  return {
    ...input,
    configHash:
      "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
    contentHash:
      "sha256:6ff279fb6419f64bc17f02eec2296a4e3de1a9d61eaad77ef19b8235c3948232",
    validationManifestRef: "retrieval-validation:index-1",
  };
}

describe("GetLegalCorpusReadinessHandler", () => {
  it("TC-01: resolves the active approved corpus at the requested effective date", async () => {
    const { handler, corpusFindFirst } = createHandler();

    await handler.execute(query());

    expect(JSON.stringify(corpusFindFirst.mock.calls)).toContain(
      "2026-08-12T00:00:00.000Z",
    );
    expect(JSON.stringify(corpusFindFirst.mock.calls)).toContain(
      LEGAL_RULE_LIFECYCLE_STATUSES.approved,
    );
  });

  it("TC-01: returns the only safe approved corpus/index readiness projection", async () => {
    const { handler, corpusFindFirst, indexFindFirst, write } = createHandler({
      corpus: {
        id: "corpus-1",
        sourceManifest: {
          rawSourceText: "must never leak",
          sourceUrl: "https://official.example/private",
        },
      },
      index: {
        ...validIndex({ id: "index-1" }),
        debugPrompt: "private validation text must never leak",
      },
    });

    const response = await handler.execute(query("pinned-corpus-1"));

    expect(response).toMatchObject({
      status: AGENTIC_TOOL_STATUSES.ready,
      result: {
        corpusVersionId: "corpus_corpus-1",
        indexVersionId: "index_index-1",
        readiness: LEGAL_CORPUS_READINESS_VALUES.ready,
        missingRequirements: [],
      },
    });
    expect(JSON.stringify(response)).not.toContain("must never leak");
    expect(JSON.stringify(response)).not.toContain("official.example");
    expect(JSON.stringify(corpusFindFirst.mock.calls)).toContain(
      LEGAL_RULE_LIFECYCLE_STATUSES.approved,
    );
    expect(JSON.stringify(corpusFindFirst.mock.calls)).toContain(
      "pinned-corpus-1",
    );
    expect(JSON.stringify(indexFindFirst.mock.calls)).toContain("VALID");
    expect(JSON.stringify(write.mock.calls)).toContain("outputHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain("must never leak");
  });

  it("TC-03: fails closed for an inaccessible assessment", async () => {
    const { handler, corpusFindFirst } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(corpusFindFirst).not.toHaveBeenCalled();
  });

  it("TC-04: returns an explicit blocking limitation when the corpus lacks a valid index", async () => {
    const { handler, write } = createHandler({ index: null });

    const response = await handler.execute(query());

    expect(response).toMatchObject({
      status: AGENTIC_TOOL_STATUSES.blocked,
      coverageState: "LIMITED",
      result: {
        readiness: LEGAL_CORPUS_READINESS_VALUES.indexInvalid,
        missingRequirements: [
          LEGAL_CORPUS_READINESS_REQUIREMENTS.validRetrievalIndex,
        ],
      },
    });
    expect(response.limitations[0]?.retryable).toBe(false);
    expect(JSON.stringify(write.mock.calls)).toContain("BLOCKED");
  });

  it("TC-04: retries a transient projection error once and returns a safe terminal failure", async () => {
    const { handler, indexFindFirst, write } = createHandler({
      indexError: new Error("database details must not leak"),
    });

    const response = await handler.execute(query());

    expect(indexFindFirst).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.failed);
    expect(JSON.stringify(response)).not.toContain("database details");
    expect(JSON.stringify(write.mock.calls)).not.toContain("database details");
  });
});
