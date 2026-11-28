import { describe, expect, it } from "@jest/globals";
import {
  AgentExecutionState,
  LegalEffectStatus,
  LegalSourceLifecycleStatus,
} from "@prisma/client";
import { LEGAL_RULE_PREPARATION_STATES } from "@lcsp/contracts/legal-rule-catalog";

import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";

describe("Selected-rule cancellation presentation", () => {
  it("keeps a pending native cancellation unresolved in Admin catalog entries", async () => {
    const catalogId = "e858ec5a-7a98-4635-badb-bb198fdbe034";
    const sourceId = "ad4410d0-c414-4d26-9388-83aa3c8dcd04";
    const documentId = "LAW-134-2025-QH15";
    const locator = "art-7::cl-5";
    const tx = {
      legalRuleCatalogVersion: {
        findUnique: () =>
          Promise.resolve({
            id: catalogId,
            version: "v1",
            revision: 1,
            legalSourceVersionId: sourceId,
            legalSourceVersion: {
              id: sourceId,
              version: "v1",
              status: LegalSourceLifecycleStatus.ACTIVE,
              retrievalIndexes: [{ id: "index-1", contentHash: "hash-1" }],
            },
            rules: [
              {
                id: "rule-1",
                legalRuleId: "legal-rule-1",
                title: "Selected rule",
                description: "Selected description",
                citationLocatorRefs: [{ documentId, locator }],
                preparation: {
                  results: [
                    {
                      id: "result-1",
                      revision: 1,
                      preparationRunId: "run-1",
                      inputSnapshot: {},
                      inputFingerprint: "old-input",
                      output: null,
                      preparationRun: {
                        executionState: AgentExecutionState.CANCEL_REQUESTED,
                        legalSourceVersionId: sourceId,
                      },
                    },
                  ],
                },
              },
            ],
          }),
      },
      legalDocumentChunk: {
        findMany: () =>
          Promise.resolve([
            {
              id: "chunk-1",
              documentId,
              locator,
              contentSha256: `sha256:${"a".repeat(64)}`,
              legalEffectStatus: LegalEffectStatus.EFFECTIVE,
            },
          ]),
      },
    };
    const service = Reflect.construct(LegalRuleCatalogService, [
      {},
      {},
      {},
    ]) as LegalRuleCatalogService;

    const result = await service.entries(
      tx as unknown as Parameters<LegalRuleCatalogService["entries"]>[0],
      catalogId,
      "cancel-pending-test",
    );

    expect(result.items[0].state).toBe(LEGAL_RULE_PREPARATION_STATES.RUNNING);
    expect(result.items[0].lastOutcome).toBe(
      AgentExecutionState.CANCEL_REQUESTED,
    );
  });
});
