import "reflect-metadata";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES } from "@lcsp/contracts/compliance-rule-set";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { StartClaimDiscoveryDiagnosticCommand } from "./source-review.command.js";
import { StartClaimDiscoveryDiagnosticHandler } from "./start-claim-discovery-diagnostic.handler.js";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED;

afterEach(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousFlag === undefined)
    delete process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED;
  else process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED = previousFlag;
});

describe("Diagnostic database identity guard", () => {
  it("rejects when the actual Prisma target differs from an allowlisted environment URL", async () => {
    process.env.DATABASE_URL =
      "postgresql://postgres@127.0.0.1:55497/lcsp_review_frontier_test";
    process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED = "true";
    const upsert = jest.fn(() => Promise.resolve({ id: "run-1" }));
    const exportGraph = jest.fn(() => Promise.resolve(null));
    const prisma = {
      databaseTarget: { hostname: "production-db", pathname: "/lcsp_prod" },
      ruleSetPreparationRun: { upsert },
    } as unknown as PrismaService;
    const handler = new StartClaimDiscoveryDiagnosticHandler(prisma, {
      export: exportGraph,
    } as unknown as LegalDocumentGraphService);

    const result = await handler.execute(
      new StartClaimDiscoveryDiagnosticCommand(
        "853db260-27cf-4606-918f-b0b59f729328",
        "f72e8e6c-56e9-4c5e-80f1-48164d25a50a",
      ),
    );

    expect(result.outcome).toBe(COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED);
    expect(exportGraph).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
