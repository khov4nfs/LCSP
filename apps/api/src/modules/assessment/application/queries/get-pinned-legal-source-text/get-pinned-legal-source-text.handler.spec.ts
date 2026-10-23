import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetPinnedLegalSourceTextHandler } from "./get-pinned-legal-source-text.handler.js";
import { GetPinnedLegalSourceTextQuery } from "./get-pinned-legal-source-text.query.js";

const ASSESSMENT = "assessment-1";
const RULE_SET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function build(chunk: unknown) {
  const findUnique = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve(chunk);
  });
  const tx = {
    complianceRuleSetVersion: {
      findUniqueOrThrow: jest.fn((args: unknown) => {
        void args;
        return Promise.resolve({ legalSourceVersionId: SOURCE_VERSION });
      }),
    },
    legalDocumentChunk: { findUnique },
  };
  const authorizeInTx = jest.fn((client: unknown, input: unknown) => {
    void client;
    void input;
    return Promise.resolve({});
  });
  const loadPins = jest.fn(
    (client: unknown, id: string, correlation: string) => {
      void client;
      void id;
      void correlation;
      return Promise.resolve({ ruleSetVersionId: RULE_SET });
    },
  );
  const handler = new GetPinnedLegalSourceTextHandler(
    {
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaService,
    { authorizeInTx } as unknown as AssessmentRuntimeAuthority,
    { loadPins } as unknown as AssessmentCaseSupport,
  );
  return { handler, findUnique, authorizeInTx, loadPins, tx };
}

const query = () =>
  new GetPinnedLegalSourceTextQuery(
    ASSESSMENT,
    "lease",
    "DOC-1",
    "art-4::cl-2",
    "correlation",
  );

describe("Pinned legal source text for the Root", () => {
  it("reads one provision of the version the pinned rule set was prepared from, under the lease", async () => {
    const { handler, findUnique, authorizeInTx, tx } = build({
      documentId: "DOC-1",
      locator: "art-4::cl-2",
      content: "Text of the provision.",
      contentSha256: "sha256:" + "a".repeat(64),
      hierarchy: { article: "4" },
      legalStatus: "ACTIVE",
      legalEffectStatus: "UNKNOWN",
      legalStatusSourceRef: null,
      sourceDocument: {
        title: "First instrument",
        sourceEffectStatus: "IN_FORCE",
      },
    });

    const text = await handler.execute(query());

    expect(text).toMatchObject({
      documentId: "DOC-1",
      documentTitle: "First instrument",
      locator: "art-4::cl-2",
      content: "Text of the provision.",
      legalEffectStatus: "UNKNOWN",
      legalStatusSourceRef: null,
      sourceEffectStatus: "IN_FORCE",
    });
    expect(authorizeInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        assessmentId: ASSESSMENT,
        leaseToken: "lease",
      }),
    );
    // Bound to the pinned source version: never another legal source, never a newer version.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          legalSourceVersionId_documentId_locator: {
            legalSourceVersionId: SOURCE_VERSION,
            documentId: "DOC-1",
            locator: "art-4::cl-2",
          },
        },
      }),
    );
  });

  it("answers 404 for a provision that is not in the pinned version", async () => {
    const { handler } = build(null);
    await expect(handler.execute(query())).rejects.toMatchObject({
      status: 404,
    });
  });
});
