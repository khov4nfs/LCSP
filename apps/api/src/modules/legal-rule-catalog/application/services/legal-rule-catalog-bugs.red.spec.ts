import { describe, expect, it, jest } from "@jest/globals";
import { LegalEffectStatus } from "@prisma/client";
import {
  LegalRuleCatalogService,
  catalogFailure,
} from "./legal-rule-catalog.service.js";
import { PreparationRuleService } from "./preparation-rule.service.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { sha256Hex } from "../../../assessment/domain/domain-ids.js";
import { fixtureSourceAuthority } from "../../../../../test/support/fixture-source-authority.js";

const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

type Call = (...args: unknown[]) => Promise<unknown>;
const resolves = (value: unknown) => jest.fn<Call>().mockResolvedValue(value);

/**
 * RED tests reproducing the core architecture bugs identified during review:
 * 1. Bug C-01: CRLF vs LF discrepancy causing false INELIGIBLE rejections on legal chunk hydration.
 * 2. Bug C-02: Unordered row locking hazard in PreparationRule upsert loop (Deadlock hazard).
 * 3. Bug A-02: Advisory lock namespace collision hazard.
 */
describe("Legal Rule Catalog - Bug Reproductions (RED Tests)", () => {
  describe("Bug C-01: CRLF vs LF Newline Normalization Failure in hydrate()", () => {
    it("fails when chunk content contains Windows CRLF line endings matching canonical LF hash", async () => {
      // Background:
      // A chunk stored with Windows-style newlines '\r\n' has a canonical hash calculated from Unix '\n'.
      // Current implementation in hydrate() strictly compares sha256Hex(chunk.content) === ref.contentSha256 without normalizing CRLF to LF.
      const canonicalText = "Line 1\nLine 2";
      const windowsChunkText = "Line 1\r\nLine 2";
      const canonicalHash = sha256Hex(canonicalText);

      const mockPrisma = {
        legalRetrievalIndex: {
          findMany: resolves([
            {
              id: uuid(5),
              legalSourceVersionId: uuid(4),
              contentHash: "sha256:index-hash",
              legalSourceVersion: { status: "ACTIVE" },
            },
          ]),
        },
        legalDocumentChunk: {
          findMany: resolves([
            {
              id: "chunk-1",
              legalSourceVersionId: uuid(4),
              documentId: "doc-1",
              locator: "art-1::cl-1",
              content: windowsChunkText, // Contains \r\n
              contentSha256: `sha256:${canonicalHash}`, // Pinned hash was calculated on \n
              legalEffectStatus: LegalEffectStatus.EFFECTIVE,
            },
          ]),
        },
      } as unknown as PrismaService;

      const service = new LegalRuleCatalogService(
        mockPrisma,
        {} as any,
        {} as any,
        // Isolate newline handling from independently tested official-source admission.
        fixtureSourceAuthority,
      );

      const inputs = [
        {
          ruleId: uuid(1),
          legalRuleId: "rule-1",
          title: "Rule 1",
          description: "Desc",
          catalogVersionId: uuid(3),
          catalogVersion: "v1",
          catalogRevision: 1,
          legalSourceVersionId: uuid(4),
          sourceVersion: "v1",
          indexId: uuid(5),
          indexContentHash: "sha256:index-hash",
          citations: [
            {
              chunkId: "chunk-1",
              documentId: "doc-1",
              locator: "art-1::cl-1",
              contentSha256: `sha256:${canonicalHash}`,
              content: "",
            },
          ],
        },
      ];

      // A properly resilient implementation should normalize CRLF to LF and accept the chunk.
      // Current code throws INELIGIBLE because sha256Hex(windowsChunkText) !== canonicalHash!
      // This assertion asserts that the hydrate call should SUCCEED.
      // Therefore, this test will FAIL (RED) on current production code!
      const hydrated = await service.hydrate(mockPrisma as any, inputs, "test-cid");
      expect(hydrated[0].citations[0].content).toBeDefined();
    });
  });

  describe("Bug C-02: Unordered row locking hazard in submit()", () => {
    it("demonstrates that submit() performs SELECT ... FOR UPDATE in client input order instead of sorted ID order", async () => {
      // Background:
      // When 2 transactions lock rows A & B in reverse order, a PostgreSQL deadlock occurs.
      // To prevent deadlocks, row locks on the same table MUST always be acquired in sorted ascending order.
      const lockQueryOrder: string[] = [];

      const inputZ = {
        ruleId: uuid(20), // ID-Z
        legalRuleId: "rule-z",
        title: "Rule Z",
        description: "Z",
        catalogVersionId: uuid(3),
        catalogVersion: "v1",
        catalogRevision: 1,
        legalSourceVersionId: uuid(4),
        sourceVersion: "v1",
        indexId: uuid(5),
        indexContentHash: "hash-1",
        citations: [
          {
            chunkId: "c-z",
            documentId: "d-1",
            locator: "art-1",
            contentSha256: `sha256:${"a".repeat(64)}`,
            content: "Text Z",
          },
        ],
      };

      const inputA = {
        ruleId: uuid(10), // ID-A
        legalRuleId: "rule-a",
        title: "Rule A",
        description: "A",
        catalogVersionId: uuid(3),
        catalogVersion: "v1",
        catalogRevision: 1,
        legalSourceVersionId: uuid(4),
        sourceVersion: "v1",
        indexId: uuid(5),
        indexContentHash: "hash-1",
        citations: [
          {
            chunkId: "c-a",
            documentId: "d-1",
            locator: "art-2",
            contentSha256: `sha256:${"b".repeat(64)}`,
            content: "Text A",
          },
        ],
      };

      const tx = {
        $executeRaw: resolves(1),
        preparationRuleBatch: {
          findUnique: resolves(null),
          create: resolves({ id: "batch-1" }),
          update: resolves({ id: "batch-1" }),
        },
        preparationRuleSelection: {
          findUnique: resolves({
            id: uuid(99),
            createdBy: "user-1",
            catalogVersionId: uuid(3),
            catalogRevision: 1,
            inputs: [inputZ, inputA], // Given in Z, A order
            fingerprint: "fp-1",
          }),
        },
        preparationRule: {
          upsert: jest.fn<any>().mockImplementation(async ({ where }: any) => {
            return {
              id: where.legalRuleId === uuid(20) ? "artifact-z" : "artifact-a",
            };
          }),
        },
        // Capture the order in which locks are executed!
        $queryRaw: jest.fn<any>().mockImplementation(async (query: any, ...values: any[]) => {
          let sqlText = "";
          if (query && typeof query === "object" && "strings" in query && "values" in query) {
            // Prisma.Sql object
            sqlText = `${query.strings.join(" ")} ${JSON.stringify(query.values)}`;
          } else {
            const sql = Array.isArray(query) ? query.join("?") : String(query);
            sqlText = `${sql} ${values.join(",")}`;
          }
          if (sqlText.includes("FOR UPDATE")) {
            // Check if it's the batch query with IN clause
            const matchArtifactA = sqlText.indexOf("artifact-a");
            const matchArtifactZ = sqlText.indexOf("artifact-z");
            if (matchArtifactA !== -1 && matchArtifactZ !== -1) {
              if (matchArtifactA < matchArtifactZ) {
                lockQueryOrder.push("artifact-a", "artifact-z");
              } else {
                lockQueryOrder.push("artifact-z", "artifact-a");
              }
            } else {
              if (matchArtifactZ !== -1) lockQueryOrder.push("artifact-z");
              if (matchArtifactA !== -1) lockQueryOrder.push("artifact-a");
            }
          }
          return [];
        }),
        preparationRuleResult: {
          findFirst: resolves(null),
          create: resolves({ id: "res-1" }),
        },
        ruleSetPreparationRun: {
          create: resolves({ id: "run-1", correlationId: "c-1" }),
          update: resolves({ id: "run-1" }),
        },
      };

      const mockPrisma = {
        $transaction: jest.fn<any>().mockImplementation(async (cb: any) => cb(tx)),
      } as unknown as PrismaService;

      const mockCatalogs = {
        lock: resolves(undefined),
        entries: resolves({
          items: [
            { id: inputZ.ruleId, input: inputZ },
            { id: inputA.ruleId, input: inputA },
          ],
        }),
        hydrate: resolves([inputZ, inputA]),
        record: resolves(undefined),
      };

      const service = new PreparationRuleService(
        mockPrisma,
        mockCatalogs as any,
        { enqueue: resolves("outbox-1") } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      jest.spyOn(service, "batch").mockResolvedValue({ id: "batch-1" } as any);

      await service.submit(
        { selectionId: uuid(99), idempotencyKey: "idem-1" },
        "user-1",
        "cid-1",
      );

      // EXPECTATION FOR SAFE CODE (NO DEADLOCK):
      // Row locks MUST be ordered alphabetically: ["artifact-a", "artifact-z"]
      // ACTUAL BEHAVIOR IN CURRENT CODE:
      // Loop processes in client order, so lockQueryOrder is ["artifact-z", "artifact-a"].
      // This test FAILS (RED) on current production code!
      expect(lockQueryOrder).toEqual(["artifact-a", "artifact-z"]);
    });
  });

  describe("Bug A-02: Advisory Lock Namespace Isolation Hazard", () => {
    it("demonstrates pg_advisory_xact_lock uses single 64-bit hashtextextended without a domain namespace", async () => {
      // Background:
      // Current line 128:
      // await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor}:${request.idempotencyKey}`}, 0))`
      let capturedSql = "";
      const tx = {
        $executeRaw: jest.fn<any>().mockImplementation(async (strings: any, ...values: any[]) => {
          capturedSql = Array.isArray(strings) ? strings.join("?") : String(strings);
          return 1;
        }),
        preparationRuleBatch: {
          findUnique: resolves(null),
        },
        preparationRuleSelection: {
          findUnique: resolves(null),
        },
      };

      const mockPrisma = {
        $transaction: jest.fn<any>().mockImplementation(async (cb: any) => cb(tx)),
      } as unknown as PrismaService;

      const service = new PreparationRuleService(
        mockPrisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      try {
        await service.submit(
          { selectionId: uuid(1), idempotencyKey: "idem-1" },
          "user-1",
          "cid-1",
        );
      } catch {
        // May throw NOT_FOUND after lock, which is expected
      }

      // Safe pattern requires 2-argument advisory lock with an explicit 32-bit namespace ID, e.g.
      // SELECT pg_advisory_xact_lock(?, hashtext(?))
      expect(capturedSql).toMatch(/pg_advisory_xact_lock\s*\(\s*(?:\?|0x[0-9a-fA-F]+|\d+)\s*,\s*hashtext/u);
    });
  });
});
