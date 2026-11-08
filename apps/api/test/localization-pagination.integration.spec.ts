import { beforeAll, afterAll, describe, it, expect, jest } from "@jest/globals";
import { randomUUID, createHash } from "node:crypto";
import {
  PrismaClient,
  AuthoredLocalizationLocale,
  AuthoredLocalizationState,
  AuthoredSourceLanguage,
} from "@prisma/client";
import { AssessmentDetailLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-detail.loader.js";
import { LocalePresentationProjectionService } from "../src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.js";
import { DECISION_RESOLUTION_STATES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
} from "../src/platform/localization/authored-localization.service.js";
import type { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_FILTERS,
  AUTHORED_LOCALIZATION_CODES,
  ASSESSMENT_AUDIT_MODES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
} from "@lcsp/contracts/assessment-domain";
const url = process.env.LCSP_TEST_LOCALIZATION_DATABASE_URL;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
(url ? describe : describe.skip)(
  "localization PostgreSQL cursors, global metrics and exact coverage concepts",
  () => {
    let db: PrismaClient,
      replica: PrismaClient,
      service: AuthoredLocalizationService,
      other: AuthoredLocalizationService;
    beforeAll(async () => {
      if (
        !url ||
        new URL(url).hostname !== "127.0.0.1" ||
        !new URL(url).pathname.includes("lcsp347_localization_test")
      )
        throw new Error("Dedicated disposable database required");
      db = new PrismaClient({ adapter: new PrismaPg(url) });
      replica = new PrismaClient({ adapter: new PrismaPg(url) });
      await Promise.all([db.$connect(), replica.$connect()]);
      service = new AuthoredLocalizationService(db as PrismaService);
      other = new AuthoredLocalizationService(replica as PrismaService);
    });
    afterAll(async () => {
      await Promise.all([db?.$disconnect(), replica?.$disconnect()]);
    });
    it("discovers scope 30, all 320 jobs, current revisions and invariant global metrics, then reviews all fields durably", async () => {
      const prefix = `000-pagination-${randomUUID()}-`;
      const scopes = Array.from(
        { length: 30 },
        (_, index) => prefix + String(index + 1).padStart(2, "0"),
      );
      const before = await service.backlog();
      const rows = scopes
        .flatMap((scopeId, index) =>
          Array.from({ length: index === 29 ? 160 : 1 }, (_, field) =>
            [AuthoredLocalizationLocale.EN, AuthoredLocalizationLocale.VI].map(
              (locale) => ({
                id: randomUUID(),
                idempotencyKey: randomUUID(),
                scopeId,
                entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
                entityId: `event-${field}`,
                canonicalRevision: "1",
                canonicalDigest: hash(scopeId + field),
                fieldPath: "/summary",
                locale,
                originalContent: `Fixture narrative ${field}`,
                originSha256: hash(`Fixture narrative ${field}`),
                createdAt:
                  index === 29
                    ? new Date(
                        Date.now() -
                          (before.operations.oldestPendingAgeSeconds + 86400) *
                            1000,
                      )
                    : new Date(),
                state:
                  index === 25
                    ? AuthoredLocalizationState.FAILED
                    : AuthoredLocalizationState.PENDING,
                attempts: index === 25 ? 3 : 0,
              }),
            ),
          ),
        )
        .flat();
      await db.authoredLocalizationRequest.createMany({ data: rows });
      for (const index of [26, 27]) {
        const job = rows.find((row) => row.scopeId === scopes[index])!;
        await service.reviewSource(
          job.scopeId,
          job.id,
          {
            originSha256: job.originSha256,
            canonicalRevision: job.canonicalRevision,
            sourceLanguage: AuthoredSourceLanguage.EN,
            evidence: "Verified isolated fixture origin language",
          },
          "fixture-source-reviewer",
        );
      }
      await db.authoredLocalizationRequest.updateMany({
        where: { scopeId: scopes[27] },
        data: {
          attempts: 1,
          errorCode: AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED,
        },
      });
      const mixed = rows.find((row) => row.scopeId === scopes[24])!;
      await service.reviewSource(
        mixed.scopeId,
        mixed.id,
        {
          originSha256: mixed.originSha256,
          canonicalRevision: mixed.canonicalRevision,
          sourceLanguage: AuthoredSourceLanguage.MIXED,
          evidence: "Explicitly mixed synthetic fixture source",
        },
        "fixture-source-reviewer",
      );
      const output = rows.find((row) => row.scopeId === scopes[28])!;
      await db.authoredTranslationCandidate.create({
        data: {
          requestId: output.id,
          content: "Synthetic candidate",
          contentSha256: hash("Synthetic candidate"),
          engine: "isolated-fixture",
          engineVersion: "1",
        },
      });
      const native = rows[0];
      await service.reviewOutput(
        native.scopeId,
        native.id,
        {
          originSha256: native.originSha256,
          contentSha256: hash("Reviewed synthetic output"),
          normalizedContent: "Reviewed synthetic output",
          confirmsTargetLanguageAndMeaning: true,
          evidence: "Explicit target-language fixture normalization",
        },
        "fixture-output-reviewer",
      );
      for (const [scope, filter, count] of [
        [scopes[24], AUTHORED_LOCALIZATION_FILTERS.MIXED_SOURCE, 2],
        [scopes[25], AUTHORED_LOCALIZATION_FILTERS.FAILED, 2],
        [scopes[26], AUTHORED_LOCALIZATION_FILTERS.PROVIDER_PENDING, 2],
        [scopes[27], AUTHORED_LOCALIZATION_FILTERS.PROVIDER_FAILED, 2],
        [scopes[28], AUTHORED_LOCALIZATION_FILTERS.OUTPUT_REVIEW_REQUIRED, 1],
        [scopes[0], AUTHORED_LOCALIZATION_FILTERS.READY, 1],
      ] as const) {
        expect(
          (await service.reviewQueue(scope, undefined, 100, filter)).items,
        ).toHaveLength(count);
      }
      const oldest = rows.find((row) => row.scopeId === scopes[29])!;
      const pages: Awaited<
        ReturnType<AuthoredLocalizationService["backlog"]>
      >[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.backlog(cursor);
        pages.push(page);
        cursor = page.nextAfterScopeId ?? undefined;
      } while (
        cursor &&
        !pages
          .flatMap((p) => p.scopes)
          .some((scope) => scope.scopeId === scopes[29])
      );
      expect(pages.length).toBeGreaterThan(1);
      expect(
        new Set(
          pages.flatMap((page) => page.scopes.map((scope) => scope.scopeId)),
        ).size,
      ).toBe(pages.flatMap((page) => page.scopes).length);
      expect(
        pages
          .flatMap((page) => page.scopes)
          .filter((scope) => scopes.includes(scope.scopeId)),
      ).toHaveLength(30);
      expect(
        pages[0].operations.failedJobCount - before.operations.failedJobCount,
      ).toBe(2);
      expect(
        pages[0].operations.retryCount - before.operations.retryCount,
      ).toBe(4);
      expect(pages[0].operations.oldestPendingAgeSeconds).toBeGreaterThan(
        before.operations.oldestPendingAgeSeconds + 86399,
      );
      expect(pages.at(-1)!.operations.failedJobCount).toBe(
        pages[0].operations.failedJobCount,
      );
      const jobs: Awaited<
        ReturnType<AuthoredLocalizationService["reviewQueue"]>
      >["items"] = [];
      let after: string | undefined;
      do {
        const page = await service.reviewQueue(scopes[29], after);
        jobs.push(...page.items);
        after = page.nextAfter ?? undefined;
      } while (after);
      expect(jobs).toHaveLength(320);
      expect(new Set(jobs.map((job) => job.id)).size).toBe(320);
      // Historical READY cannot hide a newer pending generation.
      await service.reviewOutput(
        scopes[29],
        oldest.id,
        {
          originSha256: oldest.originSha256,
          contentSha256: hash("Reviewed fixture"),
          normalizedContent: "Reviewed fixture",
          confirmsTargetLanguageAndMeaning: true,
          evidence: "Explicit isolated fixture language review",
        },
        "fixture-admin",
      );
      await db.authoredLocalizationRequest.create({
        data: {
          ...oldest,
          id: randomUUID(),
          idempotencyKey: randomUUID(),
          translationRevision: 2,
        },
      });
      const current = await service.reviewQueue(
        scopes[29],
        undefined,
        200,
        AUTHORED_LOCALIZATION_FILTERS.SOURCE_REVIEW_REQUIRED,
      );
      expect(current.items.some((job) => job.id === oldest.id)).toBe(false);
      expect(
        (
          await service.reviewQueue(
            scopes[29],
            undefined,
            200,
            AUTHORED_LOCALIZATION_FILTERS.READY,
          )
        ).items.some((job) => job.id === oldest.id),
      ).toBe(false);
      let currentAfter: string | undefined;
      const effective: Awaited<
        ReturnType<AuthoredLocalizationService["reviewQueue"]>
      >["items"] = [];
      do {
        const page = await service.reviewQueue(scopes[29], currentAfter);
        effective.push(...page.items);
        currentAfter = page.nextAfter ?? undefined;
      } while (currentAfter);
      expect(
        effective.find(
          (job) =>
            job.entityId === oldest.entityId &&
            job.locale === oldest.locale.toLowerCase(),
        )?.translationRevision,
      ).toBe(2);
      for (let offset = 0; offset < effective.length; offset += 50) {
        const result = await service.batchReviewOutput(
          scopes[29],
          {
            confirmsTargetLanguageAndMeaning: true,
            evidence: "Explicit review of synthetic target narratives",
            items: effective.slice(offset, offset + 50).map((job) => ({
              requestId: job.id,
              originSha256: job.originSha256,
              contentSha256: hash(`Reviewed ${job.locale} ${job.entityId}`),
              normalizedContent: `Reviewed ${job.locale} ${job.entityId}`,
            })),
          },
          "fixture-admin",
        );
        expect(result.rejectedCount).toBe(0);
      }
      expect(
        (
          await other.reviewQueue(
            scopes[29],
            undefined,
            100,
            AUTHORED_LOCALIZATION_FILTERS.SOURCE_REVIEW_REQUIRED,
          )
        ).items,
      ).toHaveLength(0);
      expect(await other.scopeReadiness(scopes[29], "en")).toBe(
        AUTHORED_LOCALIZATION_READINESS_STATES.READY,
      );
      expect(await other.scopeReadiness(scopes[29], "vi")).toBe(
        AUTHORED_LOCALIZATION_READINESS_STATES.READY,
      );
    }, 30000);
    it("bulk projects /concept with exact entity, digest, locale and scope; identical source text remains independent", async () => {
      const scopeId = randomUUID();
      const rules = [1, 2].map((n) => ({
        assessmentRuleId: `RULE-${n}`,
        contentDigest: hash(`${scopeId}-${n}`),
        concept: "Ki?m so?t truy c?p",
      }));
      for (const rule of rules) {
        await db.$transaction((tx) =>
          enqueueAuthoredDocument(tx, {
            scopeId,
            entityType: AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE,
            entityId: rule.assessmentRuleId,
            canonicalRevision: rule.contentDigest,
            document: { concept: rule.concept },
          }),
        );
        const jobs = await service.reviewQueue(scopeId);
        for (const job of jobs.items.filter(
          (job) => job.entityId === rule.assessmentRuleId,
        )) {
          const content =
            job.locale === "en"
              ? `Access control ${rule.assessmentRuleId}`
              : rule.concept;
          await service.reviewOutput(
            scopeId,
            job.id,
            {
              originSha256: job.originSha256,
              contentSha256: hash(content),
              normalizedContent: content,
              confirmsTargetLanguageAndMeaning: true,
              evidence:
                "Reviewed synthetic coverage concept in requested locale",
            },
            "fixture-reviewer",
          );
        }
      }
      // Actual Detail loader and persistent localization over canonical repository-port fixtures.
      const assessmentId = randomUUID();
      const row = {
        id: assessmentId,
        name: "Controlled coverage fixture",
        ownerId: "fixture-owner",
        lifecycleState: null,
        lifecycleRevision: null,
        blockerReason: null,
        blockerReference: null,
        runtime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        domainCase: {
          ruleSetVersionId: scopeId,
          caseRevision: 1,
          auditRequestRevision: 0,
          auditMode: ASSESSMENT_AUDIT_MODES.LEGACY_FULL,
          repositorySnapshotId: null,
          repositoryScanJobId: null,
          repositoryCommit: null,
          coverage: rules.map((rule) => ({
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: "v1",
            resolutionState: DECISION_RESOLUTION_STATES.PENDING,
            currentDecisionId: null,
            decisionRevision: 0,
            currentDecision: null,
          })),
          facts: [],
          humanRequests: [],
          artifacts: [],
        },
      };
      const ruleRead = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(
          rules.map((rule) => ({ ...rule, assessmentRuleVersion: "v1" })),
        );
      const tx = {
        assessment: { findUnique: () => Promise.resolve(row) },
        assessmentRule: { findMany: ruleRead },
        complianceRuleSetVersion: {
          findUnique: () =>
            Promise.resolve({
              id: scopeId,
              version: "v1",
              legalSourceVersion: { version: "fixture" },
              _count: { rules: 2, assessmentRules: 2 },
            }),
        },
        llmUsageEvent: {
          aggregate: () =>
            Promise.resolve({
              _sum: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
              },
              _count: {
                id: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
            }),
        },
      };
      const loader = new AssessmentDetailLoader(
        {
          $transaction: (work: (client: unknown) => unknown) =>
            Promise.resolve(work(tx)),
        } as PrismaService,
        new LocalePresentationProjectionService(other),
      );
      const input = {
        assessmentId,
        sessionUserId: row.ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: randomUUID(),
      };
      expect(
        (await loader.load({ ...input, locale: "en" })).case?.coverage[0]
          .concept,
      ).toBe("Access control RULE-1");
      expect(
        (await loader.load({ ...input, locale: "vi" })).case?.coverage[0]
          .concept,
      ).toBe("Ki?m so?t truy c?p");
      expect(ruleRead.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          where: {
            ruleSetVersionId: scopeId,
            OR: rules.map((rule) => ({
              assessmentRuleId: rule.assessmentRuleId,
              assessmentRuleVersion: "v1",
            })),
          },
        }),
      );
      const calls = ruleRead.mock.calls.length;
      await expect(
        loader.load({ ...input, sessionUserId: "foreign-owner", locale: "en" }),
      ).rejects.toThrow();
      expect(ruleRead).toHaveBeenCalledTimes(calls);
      ruleRead.mockResolvedValueOnce(
        rules.map((rule) => ({
          ...rule,
          assessmentRuleVersion: "wrong-version",
        })),
      );
      await expect(loader.load({ ...input, locale: "en" })).rejects.toThrow();
      const reads = jest.spyOn(replica.authoredLocalizationRequest, "findMany");
      const en = await other.projectRuleConcepts(rules, "en", scopeId);
      expect(reads).toHaveBeenCalledTimes(1);
      reads.mockRestore();
      expect(en.get("RULE-1")).toBe("Access control RULE-1");
      expect(en.get("RULE-2")).toBe("Access control RULE-2");
      expect(
        (await other.projectRuleConcepts(rules, "vi", scopeId)).get("RULE-1"),
      ).toBe("Ki?m so?t truy c?p");
      await expect(
        other.projectRuleConcepts(rules, "en", randomUUID()),
      ).rejects.toThrow();
      await expect(
        other.projectRuleConcepts(
          [{ ...rules[0], contentDigest: hash("foreign revision") }],
          "en",
          scopeId,
        ),
      ).rejects.toThrow();
      await expect(
        other.projectRuleConcepts(
          [{ ...rules[0], assessmentRuleId: "FOREIGN" }],
          "en",
          scopeId,
        ),
      ).rejects.toThrow();
      const latest = (await service.reviewQueue(scopeId)).items.find(
        (job) => job.entityId === "RULE-1" && job.locale === "en",
      )!;
      const canonical = await db.authoredLocalizationRequest.findUniqueOrThrow({
        where: { id: latest.id },
      });
      await db.authoredLocalizationRequest.create({
        data: {
          ...canonical,
          id: randomUUID(),
          idempotencyKey: randomUUID(),
          translationRevision: 2,
          state: AuthoredLocalizationState.PENDING,
          translationReviewedBy: null,
          translationReviewedAt: null,
        },
      });
      await expect(
        other.projectRuleConcepts(rules, "en", scopeId),
      ).rejects.toThrow();
      expect(rules[0].concept).toBe("Ki?m so?t truy c?p");
    });
  },
);
