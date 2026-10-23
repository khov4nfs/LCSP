import { describe, expect, it, jest } from "@jest/globals";
import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { ComplianceRuleSetReadModelLoader } from "../../../infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { GetComplianceRuleSetResultHandler } from "./get-compliance-rule-set-result.handler.js";
import { GetComplianceRuleSetResultQuery } from "./get-compliance-rule-set-result.query.js";

const RULE_SET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const readModel: ComplianceRuleSetReadModel = {
  ruleSetVersionId: RULE_SET,
  version: "legal source.p2",
  legalSourceVersionId: SOURCE,
  ruleSetDigest: "f".repeat(64),
  lifecycleState: "SUPERSEDED",
  activatedAt: "2026-10-13T00:10:00.000Z",
  legalRequirements: [],
  assessmentRules: [],
  contextRelations: [],
};

function build(row: unknown) {
  const findUnique = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve(row);
  });
  const load = jest.fn((where: unknown, correlationId: string) => {
    void where;
    void correlationId;
    return Promise.resolve(readModel);
  });
  const handler = new GetComplianceRuleSetResultHandler(
    { complianceRuleSetVersion: { findUnique } } as unknown as PrismaService,
    { load } as unknown as ComplianceRuleSetReadModelLoader,
  );
  return { handler, findUnique, load };
}

describe("Admin rule set result", () => {
  it("returns a SUPERSEDED version with its source provenance, read-only", async () => {
    const { handler, findUnique, load } = build({
      id: RULE_SET,
      preparationRunId: RUN,
      createdAt: new Date("2026-10-13T00:09:00.000Z"),
      supersededAt: new Date("2026-10-14T01:00:00.000Z"),
      legalSourceVersion: {
        id: SOURCE,
        version: "legal source",
        documents: [
          {
            documentId: "DOC-1",
            title: "First instrument",
            sourceEffectStatus: "IN_FORCE",
            _count: { chunks: 12 },
          },
        ],
      },
    });

    const result = await handler.execute(
      new GetComplianceRuleSetResultQuery(RULE_SET, "correlation"),
    );

    expect(result.ruleSet.version).toBe("legal source.p2");
    expect(result.supersededAt).toBe("2026-10-14T01:00:00.000Z");
    expect(result.preparationRunId).toBe(RUN);
    expect(result.legalSourceVersion).toEqual({
      legalSourceVersionId: SOURCE,
      version: "legal source",
      documents: [
        {
          documentId: "DOC-1",
          title: "First instrument",
          sourceEffectStatus: "IN_FORCE",
          chunkCount: 12,
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RULE_SET } }),
    );
    expect(load).toHaveBeenCalledWith({ id: RULE_SET }, "correlation");
  });

  it("answers 404 for an unknown version without reading the rule set", async () => {
    const { handler, load } = build(null);
    await expect(
      handler.execute(
        new GetComplianceRuleSetResultQuery(RULE_SET, "correlation"),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(load).not.toHaveBeenCalled();
  });
});
