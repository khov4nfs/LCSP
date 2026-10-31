import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { TEST_CREDIT } from "./lcsp364-test-credit.mjs";

/**
 * Business purpose: Route a new LCSP-364 canary exclusively through its verified upgraded DB login.
 * Business rules:
 * - Only the exact test customer's unstarted PREPARING Assessments may enroll, with an active ADMIN actor.
 * - The writer must be a non-superuser login; enrollment never transfers an existing execution or rewrites history.
 * Execution flow:
 * 1. Verify operator, test account and actual session login, then lock the Assessment against concurrent activation.
 * 2. Check there are no execution, checkpoint, turn or Root-command identities; persist the immutable scope and audit.
 * Failure cases:
 * - An active/historical execution, foreign owner/login or changed enrollment aborts the transaction.
 * - Identical enrollment replays return the original scope without another audit.
 * Side effects:
 * - Adds deployment ownership metadata and audit only; normal API commands still create and admit the one Root.
 */
export async function enrollCanary({ prisma, assessmentId, actorId }) {
  return prisma.$transaction(async (tx) => {
    const actors = await tx.user.findMany({
      where: { id: { in: [actorId, TEST_CREDIT.userId] } },
    });
    if (
      !actors.some(
        (u) =>
          u.id === actorId && u.role === "ADMIN" && u.accessStatus === "ACTIVE",
      ) ||
      !actors.some(
        (u) =>
          u.id === TEST_CREDIT.userId &&
          u.email === TEST_CREDIT.email &&
          u.role === "CUSTOMER" &&
          u.accessStatus === "ACTIVE",
      )
    )
      throw new Error("ADMIN and exact test customer must be verified");
    const [login] =
      await tx.$queryRaw`SELECT session_user AS login, rolsuper FROM pg_roles WHERE rolname = session_user`;
    if (!login || login.rolsuper)
      throw new Error("Canary requires a distinct non-superuser writer login");
    await tx.$queryRaw`SELECT id FROM "Assessment" WHERE id = ${assessmentId} FOR UPDATE`;
    const assessment = await tx.assessment.findUnique({
      where: { id: assessmentId },
      include: { runtime: true },
    });
    if (!assessment || assessment.ownerId !== TEST_CREDIT.userId)
      throw new Error("Foreign Assessment denied");
    const old = await tx.assessmentExecutionIsolation.findUnique({
      where: { assessmentId },
    });
    if (old) {
      if (
        old.writerRole !== login.login ||
        old.reason !== TEST_CREDIT.reference
      )
        throw new Error("Enrollment ownership differs");
      return { assessmentId, writerRole: old.writerRole, replay: true };
    }
    if (
      assessment.lifecycleState !== "PREPARING" ||
      assessment.runtime?.currentExecutionId ||
      assessment.runtime?.checkpointId ||
      (assessment.runtime && assessment.runtime.executionState !== "QUEUED") ||
      (await tx.assessmentRuntimeTurn.count({ where: { assessmentId } })) ||
      (await tx.assessmentRootAdmissionRequest.count({
        where: { assessmentId },
      })) ||
      (await tx.outboxMessage.count({
        where: {
          aggregateId: assessmentId,
          eventType: "command.assessment.root.requested.v1",
        },
      }))
    )
      throw new Error("Only an unstarted canary may enroll");
    await tx.assessmentExecutionIsolation.create({
      data: {
        assessmentId,
        writerRole: login.login,
        actorId,
        reason: TEST_CREDIT.reference,
      },
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        eventType: "ASSESSMENT_EXECUTION_ISOLATED",
        actorId,
        correlationId: `LCSP-364:isolation:${assessmentId}`,
        resourceId: assessmentId,
        payload: {
          reference: TEST_CREDIT.reference,
          writerRole: login.login,
          testAccountVerified: true,
        },
      },
    });
    return { assessmentId, writerRole: login.login, replay: false };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const require = createRequire(
    new URL("../apps/api/package.json", import.meta.url),
  );
  const { PrismaService } = await import(
    require.resolve("@lcsp/api/operations")
  );
  const prisma = new PrismaService();
  try {
    for (const assessmentId of process.argv.slice(2))
      console.log(
        JSON.stringify(
          await enrollCanary({
            prisma,
            assessmentId,
            actorId: process.env.LCSP_TEST_GRANT_ADMIN_ID,
          }),
        ),
      );
  } finally {
    await prisma.$disconnect();
  }
}
