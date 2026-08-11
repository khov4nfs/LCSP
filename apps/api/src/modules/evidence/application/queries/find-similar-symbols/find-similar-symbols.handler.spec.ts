import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SYMBOL_SIMILARITY_DIMENSIONS } from "../../contracts/evidence/similar-symbols.contract.js";
import { FindSimilarSymbolsHandler } from "./find-similar-symbols.handler.js";
import { FindSimilarSymbolsQuery } from "./find-similar-symbols.query.js";
describe("FindSimilarSymbolsHandler", () => {
  it("returns stable structural candidates and excludes the seed", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            evidence_graph: {
              nodes: [
                {
                  node_id: "seed",
                  node_type: "FUNCTION",
                  fingerprint: { CALL_GRAPH: "same" },
                  raw_source: "secret",
                },
                {
                  node_id: "candidate",
                  node_type: "FUNCTION",
                  file_path: "src/b.ts",
                  line_number: 2,
                  evidence_refs: ["finding:2"],
                  fingerprint: { CALL_GRAPH: "same" },
                },
              ],
            },
          },
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new FindSimilarSymbolsHandler(prisma, audit).execute(
      new FindSimilarSymbolsQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "seed",
        [SYMBOL_SIMILARITY_DIMENSIONS.callGraph],
        10,
        "corr-1",
      ),
    );
    expect(response.result.candidates).toEqual([
      expect.objectContaining({ symbol_ref: "symbol:candidate", score: 1 }),
    ]);
    expect(JSON.stringify(response)).not.toContain("secret");
  });
});
