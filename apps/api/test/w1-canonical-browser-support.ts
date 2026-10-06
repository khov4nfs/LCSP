import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  AssessmentLifecycleState as PrismaAssessmentLifecycleState,
  AssessmentRuntimeEventType as PrismaAssessmentRuntimeEventType,
  AssessmentRuntimeRunStatus as PrismaAssessmentRuntimeRunStatus,
  AssessmentRuntimeStage as PrismaAssessmentRuntimeStage,
  AssessmentStatus as PrismaAssessmentStatus,
  AuthUserRole as PrismaAuthUserRole,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { hashSecret } from "../src/modules/auth/infrastructure/security/security.utils.js";

/**
 * W1.4 browser fixture for the real API GET/SSE projection paths.
 *
 * This script intentionally accepts exactly one fresh, loopback-only database
 * target. It never reads or mutates the caller's DATABASE_URL, and it aborts
 * if any fixture identity already exists so reruns cannot overwrite data.
 */
const DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public";
const OWNER_ID = "1fef0c88-0c6c-4d5d-9f50-4e52fef0c714";
const PRESENT_ASSESSMENT_ID = "2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1";
const UNAVAILABLE_ASSESSMENT_ID = "3d9c7ad9-3dc1-4c85-a1c0-9f7df4d0d2a7";
const ROOT_THREAD_ID = "4a7b2e6d-28a7-4b0d-a3c4-9c24a4e9d2f2";
const ACTIVITY_RUN_ID = "5bf4c6b0-faf2-4b2f-a542-7e6f2d0ec1aa";
const ACTIVITY_EVENT_ID = "6c1e2f53-55bf-4f8b-bfa7-5efebd4c0d77";
const CONFLICTING_ACTIVITY_TOOL_NAME = "w1-4-conflicting-browser-activity";

const AUTH_EMAIL = "w1-4-browser-owner@invalid.test";
const AUTH_PASSWORD = "W1CanonicalBrowserFixture!2026";

function assertExactDatabaseTarget(): void {
  if (process.env.DATABASE_URL !== DATABASE_URL) {
    throw new Error(
      `Refusing fixture seed: DATABASE_URL must equal the task-owned target ${DATABASE_URL}`,
    );
  }
}

async function main(): Promise<void> {
  assertExactDatabaseTarget();

  const prisma = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });
  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: OWNER_ID },
      select: { id: true },
    });
    const existingAssessments = await prisma.assessment.findMany({
      where: {
        id: { in: [PRESENT_ASSESSMENT_ID, UNAVAILABLE_ASSESSMENT_ID] },
      },
      select: { id: true },
    });
    if (existingUser || existingAssessments.length > 0) {
      throw new Error(
        "Refusing fixture seed: one or more task-owned UUIDs already exist; use a fresh database.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: OWNER_ID,
          email: AUTH_EMAIL,
          passwordHash: hashSecret(AUTH_PASSWORD),
          emailVerified: true,
          failedLoginCount: 0,
          role: PrismaAuthUserRole.CUSTOMER,
        },
      });

      await tx.assessment.create({
        data: {
          id: PRESENT_ASSESSMENT_ID,
          ownerId: OWNER_ID,
          name: "W1.4 canonical state present",
          status: PrismaAssessmentStatus.WIZARD_IN_PROGRESS,
          lifecycleState: PrismaAssessmentLifecycleState.PAUSED,
          lifecycleRevision: 7,
          blockerReason: null,
          blockerReference: Prisma.DbNull,
        },
      });
      await tx.assessmentRuntime.create({
        data: {
          assessmentId: PRESENT_ASSESSMENT_ID,
          threadId: ROOT_THREAD_ID,
          rootAgentVersion: "w1-4-browser-fixture",
          checkpointNamespace: PRESENT_ASSESSMENT_ID,
          checkpointId: null,
          currentExecutionId: ACTIVITY_RUN_ID,
          executionState: PrismaAgentExecutionState.PAUSED,
          eventSequence: 1,
          startedAt: new Date("2026-10-06T00:00:00.000Z"),
          lastResumedAt: null,
        },
      });

      await tx.assessment.create({
        data: {
          id: UNAVAILABLE_ASSESSMENT_ID,
          ownerId: OWNER_ID,
          name: "W1.4 V1 canonical state unavailable",
          status: PrismaAssessmentStatus.WIZARD_IN_PROGRESS,
          lifecycleState: null,
          lifecycleRevision: null,
          blockerReason: null,
          blockerReference: Prisma.DbNull,
        },
      });

      // Deliberately conflicting secondary activity: GET/SSE canonical ALS/AES
      // must remain PAUSED rather than being inferred from this RUNNING event.
      await tx.assessmentRuntimeEvent.create({
        data: {
          id: ACTIVITY_EVENT_ID,
          assessmentId: PRESENT_ASSESSMENT_ID,
          runId: ACTIVITY_RUN_ID,
          correlationId: ACTIVITY_RUN_ID,
          sequence: 1,
          eventType: PrismaAssessmentRuntimeEventType.RUN_STARTED,
          runStatus: PrismaAssessmentRuntimeRunStatus.RUNNING,
          stage: PrismaAssessmentRuntimeStage.SCAN,
          toolName: CONFLICTING_ACTIVITY_TOOL_NAME,
          summary:
            "Synthetic browser fixture activity; canonical state remains PAUSED.",
          inputSummaryJson: { source: "w1-4-browser-fixture" },
          outputSummaryJson: {
            deliberatelyConflictingWithCanonicalState: true,
          },
        },
      });
    });

    const [present, unavailable, activity] = await Promise.all([
      prisma.assessment.findUnique({
        where: { id: PRESENT_ASSESSMENT_ID },
        select: {
          lifecycleState: true,
          lifecycleRevision: true,
          blockerReason: true,
          blockerReference: true,
          runtime: {
            select: {
              checkpointNamespace: true,
              executionState: true,
            },
          },
        },
      }),
      prisma.assessment.findUnique({
        where: { id: UNAVAILABLE_ASSESSMENT_ID },
        select: {
          lifecycleState: true,
          lifecycleRevision: true,
          blockerReason: true,
          blockerReference: true,
          runtime: { select: { assessmentId: true } },
        },
      }),
      prisma.assessmentRuntimeEvent.findUnique({
        where: { id: ACTIVITY_EVENT_ID },
        select: { runStatus: true, eventType: true, toolName: true },
      }),
    ]);

    if (
      present?.lifecycleState !== PrismaAssessmentLifecycleState.PAUSED ||
      present.lifecycleRevision !== 7 ||
      present.blockerReason !== null ||
      present.blockerReference !== null ||
      present.runtime?.checkpointNamespace !== PRESENT_ASSESSMENT_ID ||
      present.runtime?.executionState !== PrismaAgentExecutionState.PAUSED
    ) {
      throw new Error(
        "Fixture verification failed for canonical-present assessment",
      );
    }
    if (
      unavailable?.lifecycleState !== null ||
      unavailable.lifecycleRevision !== null ||
      unavailable.blockerReason !== null ||
      unavailable.blockerReference !== null ||
      unavailable.runtime !== null
    ) {
      throw new Error(
        "Fixture verification failed for V1-unavailable assessment",
      );
    }
    if (
      activity?.eventType !== PrismaAssessmentRuntimeEventType.RUN_STARTED ||
      activity.runStatus !== PrismaAssessmentRuntimeRunStatus.RUNNING ||
      activity.toolName !== CONFLICTING_ACTIVITY_TOOL_NAME
    ) {
      throw new Error(
        "Fixture verification failed for conflicting activity event",
      );
    }

    console.log(
      JSON.stringify(
        {
          apiBaseUrl: "http://127.0.0.1:3311",
          database: {
            host: "127.0.0.1",
            port: 55439,
            name: "lcsp_w14_browser",
          },
          auth: { email: AUTH_EMAIL, password: AUTH_PASSWORD },
          ownerId: OWNER_ID,
          presentAssessmentId: PRESENT_ASSESSMENT_ID,
          unavailableAssessmentId: UNAVAILABLE_ASSESSMENT_ID,
          activityRunId: ACTIVITY_RUN_ID,
          expectations: {
            presentLifecycleState: PrismaAssessmentLifecycleState.PAUSED,
            presentLifecycleRevision: 7,
            presentExecutionState: PrismaAgentExecutionState.PAUSED,
            unavailableLifecycle: null,
            unavailableRuntime: null,
            conflictingActivityRunStatus:
              PrismaAssessmentRuntimeRunStatus.RUNNING,
            conflictingActivityToolName: CONFLICTING_ACTIVITY_TOOL_NAME,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
