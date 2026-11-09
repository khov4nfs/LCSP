import { ComplianceRuleSetHistoryLoader } from "../src/modules/compliance-rule-set/infrastructure/persistence/compliance-rule-set-history.loader.js";
import { collectPreparationPreflight } from "../scripts/lib/preparation-preflight.js";
import { beforeAll, afterAll, describe, it, expect } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  AgentStreamBoundaryType,
  LegalSourceLifecycleStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as E,
  ASSESSMENT_RUNTIME_RUN_STATUSES as S,
} from "@lcsp/contracts/evidence";
import type { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AssessmentRuntimeEventService } from "../src/platform/runtime-events/assessment-runtime-event.service.js";
import { PreparationActivityController } from "../src/modules/assessment/presentation/http/preparation-activity.controller.js";
import { RBAC_METADATA_KEY } from "../src/platform/rbac/decorators/rbac-metadata.js";
const url = process.env.LCSP_TEST_LOCALIZATION_DATABASE_URL;
(url ? describe : describe.skip)(
  "Preparation persisted journal observability",
  () => {
    let first: PrismaClient, second: PrismaClient;
    beforeAll(async () => {
      if (
        !url ||
        new URL(url).hostname !== "127.0.0.1" ||
        !new URL(url).pathname.includes("lcsp347_localization_test")
      )
        throw Error("Dedicated disposable database required");
      first = new PrismaClient({ adapter: new PrismaPg(url) });
      second = new PrismaClient({ adapter: new PrismaPg(url) });
      await Promise.all([first.$connect(), second.$connect()]);
    });
    afterAll(async () => {
      await Promise.all([first?.$disconnect(), second?.$disconnect()]);
    });
    it("blocks actual ambiguous ACTIVE fixtures inside a read-only transaction", async () => {
      const ids: string[] = [randomUUID(), randomUUID()];
      try {
        await first.legalSourceVersion.createMany({
          data: ids.map((id) => ({
            id,
            version: `preflight-disposable-${id}`,
            sourceManifest: {},
            status: LegalSourceLifecycleStatus.ACTIVE,
          })),
        });
        const result = await second.$transaction(async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return collectPreparationPreflight(tx, new URL(url!));
        });
        expect(result.blockers).toContain(
          "ACTIVE_SOURCE_SELECTION_AMBIGUOUS_OR_MISSING",
        );
        expect(result.canDispatch).toBe(false);
        expect(result.schemaGaps).toEqual([]);
        expect(result.sources.some((source) => ids.includes(source.id))).toBe(
          true,
        );
        expect(
          await first.legalSourceVersion.count({
            where: {
              id: { in: ids },
              status: LegalSourceLifecycleStatus.ACTIVE,
            },
          }),
        ).toBe(2);
      } finally {
        await first.legalSourceVersion.deleteMany({
          where: { id: { in: ids } },
        });
      }
    });
    it("pages real persisted run history across replicas with no duplicates or foreign-run events", async () => {
      const source = await first.legalSourceVersion.create({
        data: {
          version: `observability-fixture-${randomUUID()}`,
          sourceManifest: {},
        },
      });
      const ids = [randomUUID(), randomUUID()];
      for (const id of ids) {
        await first.ruleSetPreparationRun.create({
          data: {
            id,
            idempotencyKey: randomUUID(),
            legalSourceVersionId: source.id,
            requestedBy: "isolated-fixture",
            correlationId: randomUUID(),
          },
        });
        await first.assessmentRuntimeEvent.createMany({
          data: Array.from({ length: 8 }, (_, index) => {
            const n = index + 1;
            const event = {
              eventId: `${id}-${n}`,
              sequence: n,
              emittedAt: new Date(2026, 0, 1, 0, 0, n).toISOString(),
              boundaryType: AgentStreamBoundaryType.RULE_SET_PREPARATION,
              boundaryId: id,
              preparationRunId: id,
              runId: id,
              eventType: E.modelCallCompleted,
              status: S.completed,
              data: {
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              },
            };
            return {
              boundaryType: AgentStreamBoundaryType.RULE_SET_PREPARATION,
              boundaryId: id,
              preparationRunId: id,
              runId: id,
              correlationId: randomUUID(),
              sequence: n,
              toolName: "agent_stream_semantic",
              summary: "Sanitized synthetic model activity",
              createdAt: new Date(2026, 0, 1, 0, 0, n),
              outputSummaryJson: { agentStreamEvent: event },
            };
          }),
        });
      }
      const history = await new ComplianceRuleSetHistoryLoader(
        first as PrismaService,
      ).load();
      const canonical = history.preparations.find(
        (run) => run.preparationRunId === ids[0],
      );
      expect(canonical?.startedAt).toBeNull();
      expect(canonical?.persistedCoverageAvailable).toBe(false);
      expect(canonical?.persistedDraftAvailable).toBe(false);
      const service = new AssessmentRuntimeEventService(first as PrismaService),
        replica = new AssessmentRuntimeEventService(second as PrismaService);
      const newest = await service.getPreparationStreamHistoryPage(ids[0], {
        limit: 3,
      });
      expect(newest.events.map((e) => e.sequence)).toEqual([6, 7, 8]);
      expect(newest.hasMore).toBe(true);
      const middle = await replica.getPreparationStreamHistoryPage(ids[0], {
        limit: 3,
        cursor: newest.nextCursor,
      });
      expect(middle.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
      const oldest = await replica.getPreparationStreamHistoryPage(ids[0], {
        limit: 3,
        cursor: middle.nextCursor,
      });
      expect(oldest.events.map((e) => e.sequence)).toEqual([1, 2]);
      expect(oldest.hasMore).toBe(false);
      const all = [...oldest.events, ...middle.events, ...newest.events];
      expect(new Set(all.map((e) => e.eventId)).size).toBe(8);
      expect(all.every((e) => e.preparationRunId === ids[0])).toBe(true);
      expect(
        (
          await new PreparationActivityController(replica).list(ids[0], {
            limit: 3,
          })
        ).ok,
      ).toBe(true);
      await expect(
        replica.getPreparationStreamHistoryPage(ids[0], { cursor: "invalid" }),
      ).rejects.toThrow();
      expect(
        Reflect.getMetadata(RBAC_METADATA_KEY, PreparationActivityController),
      ).toEqual(expect.objectContaining({ roles: [AUTH_USER_ROLES.admin] }));
    });
  },
);
