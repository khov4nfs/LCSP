import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState,
  ArtifactLifecycleState,
  AuthUserRole,
  PrismaClient,
  RuleSetPreparationFailureReason,
} from "@prisma/client";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_REACTIVATION_ERROR_CODES as Errors,
  RULE_SET_REACTIVATION_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import {
  legalSourceFactory,
  validPacket,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  ComplianceRuleSetActivation,
  acquireComplianceRuleSetActivationLock,
} from "../../infrastructure/persistence/compliance-rule-set-activation.service.js";
import { LegalSourceSnapshotLoader } from "../../infrastructure/persistence/legal-source-snapshot.service.js";
import { StartRuleSetPreparationHandler } from "../commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { StartRuleSetPreparationCommand } from "../commands/start-rule-set-preparation/start-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { SubmitComplianceRuleSetHandler } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { SubmitComplianceRuleSetCommand } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { ReactivateComplianceRuleSetHandler } from "../commands/reactivate-compliance-rule-set/reactivate-compliance-rule-set.handler.js";
import { ReactivateComplianceRuleSetCommand } from "../commands/reactivate-compliance-rule-set/reactivate-compliance-rule-set.command.js";

const url = process.env.DATABASE_URL ?? "";
const describeDatabase =
  /@(?:localhost|127\.0\.0\.1):\d+\/lcsp_reactivation_test(?:\?|$)/.test(url)
    ? describe
    : describe.skip;
describeDatabase(
  "Rule Set reactivation on migrated disposable PostgreSQL",
  () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
    const db = prisma as unknown as PrismaService;
    const audit = new AuditWriterService(db);
    const outbox = new OutboxRepository(db);
    const handler = new ReactivateComplianceRuleSetHandler(db, audit, outbox);
    const start = new StartRuleSetPreparationHandler(db, outbox);
    const claim = new ClaimRuleSetPreparationHandler(db);
    const submit = new SubmitComplianceRuleSetHandler(
      db,
      new LegalSourceSnapshotLoader(db),
      new ComplianceRuleSetActivation(outbox, audit),
    );
    const source = legalSourceFactory(prisma, randomUUID());
    let admin: string;
    let customer: string;
    let a: string;
    let b: string;
    let key: string;
    beforeAll(async () => {
      await prisma.$connect();
      admin = (
        await prisma.user.create({
          data: {
            id: randomUUID(),
            email: `${randomUUID()}@test.invalid`,
            passwordHash: "test-only",
            emailVerified: true,
            failedLoginCount: 0,
            role: AuthUserRole.ADMIN,
          },
        })
      ).id;
      customer = (
        await prisma.user.create({
          data: {
            id: randomUUID(),
            email: `${randomUUID()}@test.invalid`,
            passwordHash: "test-only",
            emailVerified: true,
            failedLoginCount: 0,
            role: AuthUserRole.CUSTOMER,
          },
        })
      ).id;
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });
    const run = async () => {
      const legalSource = await source();
      const r = await start.execute(
        new StartRuleSetPreparationCommand(
          {
            legalSourceVersionId: legalSource.id,
            idempotencyKey: randomUUID(),
          },
          admin,
          randomUUID(),
        ),
      );
      await claim.execute(
        new ClaimRuleSetPreparationCommand(
          { preparationRunId: r.preparationRunId },
          randomUUID(),
        ),
      );
      return r.preparationRunId;
    };
    const publish = async (id = "") =>
      (
        await submit.execute(
          new SubmitComplianceRuleSetCommand(
            {
              preparationRunId: id || (await run()),
              idempotencyKey: randomUUID(),
              packet: validPacket(),
            },
            admin,
            randomUUID(),
          ),
        )
      ).ruleSetVersionId;
    const command = (
      target = a,
      expected = b,
      idempotencyKey = key,
      actorId = admin,
    ) =>
      new ReactivateComplianceRuleSetCommand(
        target,
        {
          expectedActiveRuleSetVersionId: expected,
          idempotencyKey,
          reason: RULE_SET_REACTIVATION_REASONS.SEMANTIC_AUTHORITY_CONTAINMENT,
        },
        actorId,
        randomUUID(),
      );
    beforeEach(async () => {
      a = await publish();
      const assessment = await prisma.assessment.create({
        data: {
          id: randomUUID(),
          ownerId: customer,
          name: "historical A",
          lifecycleState: "PREPARING",
          lifecycleRevision: 0,
        },
      });
      await prisma.assessmentCase.create({
        data: {
          assessmentId: assessment.id,
          ruleSetVersionId: a,
          caseRevision: 0,
          pinnedAt: new Date(),
        },
      });
      b = await publish();
      key = randomUUID();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.ruleSetPreparationRun.updateMany({
        where: {
          executionState: {
            in: [AgentExecutionState.QUEUED, AgentExecutionState.RUNNING],
          },
        },
        data: {
          executionState: AgentExecutionState.FAILED,
          failureReason: RuleSetPreparationFailureReason.RUNTIME_ERROR,
          completedAt: new Date(),
        },
      });
    });
    const snapshot = () =>
      prisma.$transaction([
        prisma.complianceRuleSetVersion.findMany({ orderBy: { id: "asc" } }),
        prisma.complianceRuleSetActivationRecord.findMany({
          orderBy: { id: "asc" },
        }),
        prisma.complianceRuleSetReactivationRecord.findMany({
          orderBy: { id: "asc" },
        }),
        prisma.auditEvent.findMany({ orderBy: { id: "asc" } }),
        prisma.outboxMessage.findMany({ orderBy: { id: "asc" } }),
        prisma.assessmentCase.findMany({ orderBy: { assessmentId: "asc" } }),
      ]);
    const expectProblem = async (p: Promise<unknown>, code: string) => {
      await expect(p).rejects.toMatchObject({
        response: { ok: false, problem: { code } },
      });
    };
    it("reactivates A, preserves original history/source/pins, and appends exactly one audit/outbox/transition", async () => {
      const original = await prisma.complianceRuleSetActivationRecord.findMany({
        orderBy: { id: "asc" },
      });
      const target = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: a },
      });
      await prisma.legalSourceVersion.update({
        where: { id: target.legalSourceVersionId },
        data: { status: "SUPERSEDED" },
      });
      const assessment = await prisma.assessment.create({
        data: {
          id: randomUUID(),
          ownerId: customer,
          name: "historical",
          lifecycleState: "PREPARING",
          lifecycleRevision: 0,
        },
      });
      await prisma.assessmentCase.create({
        data: {
          assessmentId: assessment.id,
          ruleSetVersionId: b,
          caseRevision: 0,
          pinnedAt: new Date(),
        },
      });
      const pins = await prisma.assessmentCase.findMany();
      const before = await snapshot();
      const r = await handler.execute(command());
      expect(r.replayed).toBe(false);
      expect(
        await prisma.complianceRuleSetVersion.findMany({
          where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
          select: { id: true },
        }),
      ).toEqual([{ id: a }]);
      expect(
        (
          await prisma.complianceRuleSetVersion.findUniqueOrThrow({
            where: { id: b },
          })
        ).lifecycleState,
      ).toBe(ArtifactLifecycleState.SUPERSEDED);
      expect(
        await prisma.complianceRuleSetActivationRecord.findMany({
          orderBy: { id: "asc" },
        }),
      ).toEqual(original);
      expect(await prisma.assessmentCase.findMany()).toEqual(pins);
      expect(
        (
          await prisma.legalSourceVersion.findUniqueOrThrow({
            where: { id: target.legalSourceVersionId },
          })
        ).status,
      ).toBe("SUPERSEDED");
      const after = await snapshot();
      expect(after[2].length - before[2].length).toBe(1);
      expect(after[3].length - before[3].length).toBe(1);
      expect(after[4].length - before[4].length).toBe(1);
      const record =
        await prisma.complianceRuleSetReactivationRecord.findUniqueOrThrow({
          where: { id: r.transitionId },
        });
      expect(record).toMatchObject({
        targetRuleSetVersionId: a,
        previousRuleSetVersionId: b,
        targetPreviousActivatedAt: target.activatedAt,
        targetPreviousSupersededAt: target.supersededAt,
        auditEventId: r.auditEventId,
        outboxEventId: r.outboxEventId,
      });
      expect(
        (
          await prisma.outboxMessage.findUniqueOrThrow({
            where: { id: r.outboxEventId },
          })
        ).eventType,
      ).toBe(COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetReactivated);
      await expect(
        prisma.complianceRuleSetReactivationRecord.update({
          where: { id: r.transitionId },
          data: { actorId: customer },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.complianceRuleSetReactivationRecord.delete({
          where: { id: r.transitionId },
        }),
      ).rejects.toThrow(/immutable/);
    });
    it("same-key concurrent replay returns the same receipt without duplicate effects", async () => {
      const c = command();
      const [x, y] = await Promise.all([
        handler.execute(c),
        handler.execute(c),
      ]);
      expect(x.transitionId).toBe(y.transitionId);
      expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
      expect(
        await prisma.complianceRuleSetReactivationRecord.count({
          where: { idempotencyKey: key },
        }),
      ).toBe(1);
      await expectProblem(
        handler.execute(command(b, a)),
        COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
      );
    });
    it.each([
      Errors.EXPECTED_ACTIVE_MISMATCH,
      Errors.TARGET_NOT_FOUND,
      Errors.TARGET_ALREADY_ACTIVE,
    ])("%s changes nothing", async (code) => {
      const c =
        code === Errors.EXPECTED_ACTIVE_MISMATCH
          ? command(a, randomUUID())
          : code === Errors.TARGET_NOT_FOUND
            ? command(randomUUID())
            : command(b);
      const before = await snapshot();
      await expectProblem(handler.execute(c), code);
      expect(await snapshot()).toEqual(before);
    });
    it("rejects a previously semantically rejected target", async () => {
      await handler.execute(command());
      await expectProblem(
        handler.execute(command(b, a, randomUUID())),
        Errors.TARGET_NOT_ELIGIBLE,
      );
    });
    it("fails closed with no ACTIVE authority", async () => {
      await prisma.complianceRuleSetVersion.update({
        where: { id: b },
        data: {
          lifecycleState: ArtifactLifecycleState.SUPERSEDED,
          supersededAt: new Date(),
        },
      });
      const before = await snapshot();
      await expectProblem(
        handler.execute(command()),
        Errors.NO_ACTIVE_RULE_SET,
      );
      expect(await snapshot()).toEqual(before);
    });
    it("rejects an INVALID target and an active Preparation", async () => {
      await prisma.complianceRuleSetVersion.update({
        where: { id: a },
        data: { lifecycleState: ArtifactLifecycleState.INVALID },
      });
      const before = await snapshot();
      await expectProblem(
        handler.execute(command()),
        Errors.TARGET_NOT_ELIGIBLE,
      );
      expect(await snapshot()).toEqual(before);
      await run();
      await expectProblem(
        handler.execute(command()),
        Errors.PREPARATION_IN_PROGRESS,
      );
    });
    it("rejects a corrupted stored target without changing authority", async () => {
      // Emulate damaged historical storage only in the explicitly disposable database.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "LegalRequirement" DISABLE TRIGGER "LegalRequirement_immutable"',
      );
      try {
        await prisma.legalRequirement.updateMany({
          where: { ruleSetVersionId: a },
          data: { proposition: "damaged" },
        });
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "LegalRequirement" ENABLE TRIGGER "LegalRequirement_immutable"',
        );
      }
      const before = await snapshot();
      await expectProblem(handler.execute(command()), Errors.INTEGRITY_INVALID);
      expect(await snapshot()).toEqual(before);
    });
    it.each(["", "missing-user", "customer"])(
      "denies invalid/non-Admin actor %s without mutation",
      async (actor) => {
        const before = await snapshot();
        await expectProblem(
          handler.execute(
            command(a, b, key, actor === "customer" ? customer : actor),
          ),
          AUTH_ERROR_CODES.rbacDenied,
        );
        expect(await snapshot()).toEqual(before);
      },
    );
    it.each(["audit", "outbox", "history"])(
      "rolls back statuses/history/audit/outbox if %s fails",
      async (stage) => {
        const before = await snapshot();
        if (stage === "audit")
          jest
            .spyOn(audit, "writeInTx")
            .mockRejectedValueOnce(new Error("injected audit failure"));
        if (stage === "outbox")
          jest
            .spyOn(outbox, "enqueue")
            .mockRejectedValueOnce(new Error("injected outbox failure"));
        if (stage === "history") {
          await prisma.$executeRawUnsafe(
            `CREATE TRIGGER test_reactivation_insert_failure BEFORE INSERT ON "ComplianceRuleSetReactivationRecord" FOR EACH ROW EXECUTE FUNCTION lcsp_compliance_rule_set_immutable()`,
          );
        }
        try {
          await expect(handler.execute(command())).rejects.toThrow();
        } finally {
          if (stage === "history")
            await prisma.$executeRawUnsafe(
              'DROP TRIGGER test_reactivation_insert_failure ON "ComplianceRuleSetReactivationRecord"',
            );
        }
        expect(await snapshot()).toEqual(before);
      },
    );
    it("concurrent distinct requests cannot supersede a changed ACTIVE pointer", async () => {
      const results = await Promise.allSettled([
        handler.execute(command()),
        handler.execute(command(a, b, randomUUID())),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await prisma.complianceRuleSetVersion.count({
          where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
        }),
      ).toBe(1);
    });
    it("normal activation and reactivation both wait for the same global authority lock", async () => {
      const preparation = await run();
      let release!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((r) => {
        locked = r;
      });
      const unlock = new Promise<void>((r) => {
        release = r;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await acquireComplianceRuleSetActivationLock(tx);
          locked();
          await unlock;
        },
        { timeout: 10_000 },
      );
      await ready;
      let publications = 0;
      let reactivations = 0;
      const publication = publish(preparation).finally(() => {
        publications++;
      });
      const reactivation = handler
        .execute(command())
        .then(
          () => null,
          (e: unknown) => e,
        )
        .finally(() => {
          reactivations++;
        });
      await new Promise((r) => setTimeout(r, 100));
      expect(publications).toBe(0);
      expect(reactivations).toBe(0);
      release();
      await holder;
      const next = await publication;
      expect(await reactivation).toBeTruthy();
      expect(
        (
          await prisma.complianceRuleSetVersion.findFirstOrThrow({
            where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
          })
        ).id,
      ).toBe(next);
      expect(
        (
          await prisma.ruleSetPreparationRun.findUniqueOrThrow({
            where: { id: preparation },
          })
        ).executionState,
      ).toBe(AgentExecutionState.SUCCEEDED);
    });
  },
);
