import { randomUUID } from "node:crypto";
import { Client } from "pg";

import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentBlockerSchema,
  type AgentExecutionState,
  type AssessmentLifecycleState,
  type BlockerReason,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  type AssessmentRootClaim,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

function extractSavedLocale(data: unknown): string | undefined {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const raw =
    record.responseLanguage ??
    record.response_language ??
    record.locale ??
    record.language ??
    record.lcsp_locale;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import { AssessmentLifecycleCoordinator } from "./assessment-lifecycle-coordinator.service.js";
import { AssessmentEventAppender } from "./assessment-event-appender.service.js";

export interface AuthorizedRootRun {
  assessmentId: string;
  threadId: string;
  executionId: string;
  lifecycleState: string;
  lifecycleRevision: number;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
}

const ROOT_ACTOR = {
  id: AUDIT_ACTOR_IDS.assessmentRootAgent,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

const NATIVE_ROOT_CHECKPOINT_NAMESPACE = "";
const NATIVE_ROOT_BOUNDARY_NAME = "assessment_root_requested";
const NATIVE_ROOT_AGENT_NAME = "lcsp-assessment-root";

/**
 * Server-owned Root run authority. An agent can never name its own assessment, thread,
 * execution or lease: the API issues them at claim time and every governed tool call must
 * present the lease, which is bound to exactly one assessment/thread/execution.
 */
@Injectable()
export class AssessmentRuntimeAuthority {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AssessmentEventAppender,
    private readonly coordinator: AssessmentLifecycleCoordinator,
  ) {}

  /**
   * Business purpose: Claim the one authorized Root execution for an assessment retry or continuation.
   *
   * Business rules:
   * - A live lease excludes a competing execution; a retry after failure uses a new execution ID on the same thread.
   * - A failed checkpoint is resumable only when the runtime row and failed Root turn bind the same checkpoint,
   *   or a missing API checkpoint is recovered from the latest native Root checkpoint with matching persisted
   *   assessment, runtime, boundary, agent, and timestamp provenance.
   * - Missing or inconsistent checkpoint IDs and metadata grant no checkpoint authority.
   * - Human interrupts, safe pauses, and authenticated transport recovery retain their existing lifecycle guards.
   *
   * Execution flow:
   * 1. Lock the assessment/runtime and load the current Root turn.
   * 2. Validate lifecycle, lease, and any failed-turn checkpoint binding; recover a missing checkpoint only
   *    from the canonical native checkpoint store under the same assessment transaction.
   * 3. Issue a lease and execution identity, returning only the authorized resume checkpoint.
   *
   * Failure cases:
   * - Missing runtime, inactive lifecycle, held lease, or invalid guarded recovery returns the corresponding domain problem.
   * - A failed turn with no matching checkpoint record remains claimable as a fresh attempt without checkpoint authority.
   *
   * Side effects:
   * - Updates runtime and turn execution state, issues a lease, and appends an execution-state event when needed.
   */
  async claimRoot(input: {
    assessmentId: string;
    correlationId: string;
    runtimeRunId?: string;
  }): Promise<AssessmentRootClaim> {
    return this.prisma.$transaction(async (tx) => {
      const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
      if (!row) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const previousTurn = row.currentExecutionId
        ? await tx.assessmentRuntimeTurn.findUnique({
            where: { id: row.currentExecutionId },
          })
        : null;
      const failedCheckpointJson =
        previousTurn?.checkpointJson &&
        typeof previousTurn.checkpointJson === "object" &&
        !Array.isArray(previousTurn.checkpointJson)
          ? previousTurn.checkpointJson
          : null;
      const failedCheckpointId =
        row.executionState === AGENT_EXECUTION_STATES.FAILED &&
        row.checkpointId &&
        previousTurn?.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        previousTurn.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.state === Controls.completed &&
        failedCheckpointJson?.checkpointId === row.checkpointId
          ? row.checkpointId
          : null;
      const previousContextJson =
        previousTurn?.contextJson &&
        typeof previousTurn.contextJson === "object" &&
        !Array.isArray(previousTurn.contextJson)
          ? previousTurn.contextJson
          : null;
      const previousRuntimeRunId = previousContextJson?.runtimeRunId;
      const caseRow = tx.assessmentCase
        ? await tx.assessmentCase.findUnique({
            where: { assessmentId: input.assessmentId },
            select: {
              ruleSetVersionId: true,
              repositorySnapshotId: true,
              repositoryCommit: true,
            },
          })
        : null;
      const nativeCheckpointRecovery =
        row.executionState === AGENT_EXECUTION_STATES.FAILED &&
        row.checkpointId === null &&
        previousTurn?.id === row.currentExecutionId &&
        previousTurn.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        previousTurn.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.state === Controls.completed &&
        previousTurn.checkpointJson === null &&
        typeof previousRuntimeRunId === "string" &&
        previousRuntimeRunId.length > 0
          ? await findFailedNativeCheckpoint(tx, {
              assessmentId: input.assessmentId,
              threadId: row.threadId,
              runtimeRunId: previousRuntimeRunId,
              turnCreatedAt: previousTurn.createdAt,
              turnUpdatedAt: previousTurn.updatedAt,
              casePins: caseRow ?? undefined,
            })
          : null;
      const resumedCheckpointId =
        failedCheckpointId ?? nativeCheckpointRecovery?.checkpointId ?? null;
      const nativeCheckpointRecoveryContext = nativeCheckpointRecovery && {
        nativeCheckpointRecovery: {
          checkpointId: nativeCheckpointRecovery.checkpointId,
          checkpointTimestamp: nativeCheckpointRecovery.checkpointTimestamp,
          resumedFromExecutionId: previousTurn?.id ?? null,
          recoverySource: "NATIVE_CHECKPOINT_METADATA",
        },
      };
      const recoveredExecution = Boolean(
        input.runtimeRunId &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        previousTurn?.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        (previousTurn.contextJson as Prisma.JsonObject)?.runtimeRunId ===
          input.runtimeRunId,
      );
      // The authenticated transport serializes this persisted run with a PostgreSQL thread lock.
      const recoveredComplete =
        recoveredExecution &&
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE;
      const blockedRequestId = humanFactBlockerRequestId(row);
      const blockedHumanWait =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blockedRequestId !== null &&
        (await tx.assessmentHumanRequest.count({
          where: {
            assessmentId: input.assessmentId,
            requestId: blockedRequestId,
            threadId: row.threadId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        })) === 1;
      const recoveringHumanInterrupt =
        (row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
          blockedHumanWait) &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt <= new Date();
      const safePauseResume =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED &&
        row.executionState === AGENT_EXECUTION_STATES.PAUSED &&
        row.currentExecutionId &&
        row.checkpointId
          ? await tx.assessmentRuntimeTurn.findFirst({
              where: {
                id: row.currentExecutionId,
                assessmentId: input.assessmentId,
                threadId: row.threadId,
                boundary: ASSESSMENT_ROOT_BOUNDARY,
                state: Controls.resumeRequested,
              },
            })
          : null;
      if (
        row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
        !recoveringHumanInterrupt &&
        !safePauseResume &&
        !recoveredComplete &&
        !(
          recoveredExecution &&
          (row.lifecycleState ===
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
            blockedHumanWait)
        )
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const now = new Date();
      if (
        row.leaseToken &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt > now &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        !recoveredExecution
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      // A human interrupt or safe pause resumes the SAME execution; a failed, finished or
      // never-started one begins a new execution ID on the same thread (retry semantics).
      const recoveringStop = row.currentExecutionId
        ? await tx.assessmentRuntimeTurn.findFirst({
            where: {
              id: row.currentExecutionId,
              assessmentId: input.assessmentId,
              threadId: row.threadId,
              boundary: ASSESSMENT_ROOT_BOUNDARY,
              state: Controls.stopRequested,
            },
          })
        : null;
      const resumesSameExecution =
        row.currentExecutionId !== null &&
        (row.executionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
          row.executionState === AGENT_EXECUTION_STATES.PAUSED ||
          Boolean(recoveringStop) ||
          recoveredExecution);
      const executionId = resumesSameExecution
        ? (row.currentExecutionId as string)
        : randomUUID();
      const previousState = resumesSameExecution
        ? row.executionState
        : AGENT_EXECUTION_STATES.QUEUED;
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          currentExecutionId: executionId,
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          ...(nativeCheckpointRecovery
            ? { checkpointId: nativeCheckpointRecovery.checkpointId }
            : {}),
          leaseToken,
          leaseExpiresAt,
          startedAt: now,
          lastResumedAt: now,
        },
      });
      const [latestCommand] = await Promise.all([
        tx.outboxMessage?.findFirst
          ? tx.outboxMessage.findFirst({
              where: {
                aggregateId: input.assessmentId,
                eventType: ASSESSMENT_ROOT_COMMAND_TYPES["ROOT_REQUESTED"],
              },
              orderBy: { createdAt: "desc" },
              select: { payload: true },
            })
          : Promise.resolve(null),
      ]);
      const persistedLanguage =
        extractSavedLocale(latestCommand?.payload) ??
        extractSavedLocale(previousTurn?.contextJson);

      await tx.assessmentRuntimeTurn.upsert({
        where: { id: executionId },
        create: {
          id: executionId,
          assessmentId: input.assessmentId,
          threadId: row.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: executionId,
          correlationId: input.correlationId,
          state: Controls.running,
          contextJson: {
            ...(persistedLanguage
              ? { responseLanguage: persistedLanguage }
              : {}),
            ...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
            ...(nativeCheckpointRecoveryContext ?? {}),
          },
          ...(nativeCheckpointRecovery
            ? {
                checkpointJson: {
                  checkpointId: nativeCheckpointRecovery.checkpointId,
                  resumedFromExecutionId: previousTurn?.id ?? null,
                  recoverySource: "NATIVE_CHECKPOINT_METADATA",
                },
              }
            : {}),
        },
        update: {
          state: recoveringStop ? Controls.stopRequested : Controls.running,
          contextJson: {
            ...((previousTurn?.contextJson as Prisma.JsonObject) ?? {}),
            ...(persistedLanguage
              ? { responseLanguage: persistedLanguage }
              : {}),
            ...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
            ...(nativeCheckpointRecoveryContext ?? {}),
          },
        },
      });
      if (safePauseResume) {
        if (
          await tx.assessmentHumanRequest.count({
            where: {
              assessmentId: input.assessmentId,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          })
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: input.assessmentId,
            expectedRevision: row.lifecycleRevision!,
            toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
            correlationId: input.correlationId,
            actorId: ROOT_ACTOR.id,
          },
          tx,
          [
            AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
          ],
          ROOT_ACTOR,
        );
      }
      if (previousState !== AGENT_EXECUTION_STATES.RUNNING) {
        await this.events.appendInTx(tx, {
          assessmentId: input.assessmentId,
          correlationId: input.correlationId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
          executionId,
          payload: {
            fromState: previousState,
            toState: AGENT_EXECUTION_STATES.RUNNING,
          },
          auditActor: ROOT_ACTOR,
        });
      }
      return {
        assessmentId: input.assessmentId,
        threadId: row.threadId,
        executionId,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        checkpointNamespace: row.checkpointNamespace,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
        resumeCheckpointId: resumesSameExecution
          ? row.checkpointId
          : resumedCheckpointId,
        lifecycleState: safePauseResume
          ? ASSESSMENT_LIFECYCLE_STATES.ACTIVE
          : row.lifecycleState!,
        recoveredExecution,
      };
    });
  }

  /**
   * Validates a tool call's lease inside the caller's transaction and returns the server-owned
   * identity. Locks the runtime row so the lease cannot change underneath the write.
   */
  async authorizeInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      leaseToken: string | undefined;
      correlationId: string;
      requireActive?: boolean;
    },
  ): Promise<AuthorizedRootRun> {
    const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      !input.leaseToken ||
      row.leaseToken !== input.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= new Date() ||
      row.executionState !== AGENT_EXECUTION_STATES.RUNNING ||
      !row.currentExecutionId
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
        input.correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
    }
    if (
      (input.requireActive ?? true) &&
      row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return {
      assessmentId: input.assessmentId,
      threadId: row.threadId,
      executionId: row.currentExecutionId,
      lifecycleState: row.lifecycleState ?? "",
      lifecycleRevision: row.lifecycleRevision ?? 0,
      blockerReason: row.blockerReason,
      blockerReference: row.blockerReference,
    };
  }

  async authorize(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    requireActive?: boolean;
  }): Promise<AuthorizedRootRun> {
    return this.prisma.$transaction((tx) => this.authorizeInTx(tx, input));
  }

  async heartbeat(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
  }): Promise<{ leaseExpiresAt: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeInTx(tx, { ...input, requireActive: false });
      const leaseExpiresAt = new Date(
        Date.now() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: { leaseExpiresAt },
      });
      return { leaseExpiresAt: leaseExpiresAt.toISOString() };
    });
  }

  /** Ends the current execution. A terminal state never implies an assessment outcome. */
  async finishExecution(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    toState: AgentExecutionState;
    checkpointId?: string;
    requestIds?: string[];
    controlRequestId?: string;
  }): Promise<{ executionState: AgentExecutionState }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      if (
        ![
          AGENT_EXECUTION_STATES.INTERRUPTED,
          AGENT_EXECUTION_STATES.PAUSED,
          AGENT_EXECUTION_STATES.SUCCEEDED,
          AGENT_EXECUTION_STATES.FAILED,
          AGENT_EXECUTION_STATES.CANCELLED,
        ].some((state) => state === input.toState)
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      let pauseRequestId: string | null = null;
      if (input.toState === AGENT_EXECUTION_STATES.PAUSED) {
        const turn = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: run.executionId },
        });
        if (
          !input.checkpointId ||
          !input.controlRequestId ||
          !turn ||
          turn.threadId !== run.threadId ||
          turn.assessmentId !== input.assessmentId ||
          turn.boundary !== ASSESSMENT_ROOT_BOUNDARY ||
          turn.state !== Controls.stopRequested ||
          turn.requestId !== input.controlRequestId ||
          run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        pauseRequestId = turn.requestId;
      }
      if (input.toState === AGENT_EXECUTION_STATES.INTERRUPTED) {
        const requests = await tx.assessmentHumanRequest.findMany({
          where: {
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        });
        const ids = new Set(input.requestIds);
        const blockedRequestId = humanFactBlockerRequestId(run);
        const blockedHumanWait =
          run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
          blockedRequestId !== null &&
          ids.has(blockedRequestId);
        if (
          !input.checkpointId ||
          requests.length === 0 ||
          requests.length !== ids.size ||
          (run.lifecycleState !==
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
            !blockedHumanWait) ||
          requests.some(
            (request) =>
              !ids.has(request.requestId) ||
              request.threadId !== run.threadId ||
              (request.checkpointId &&
                request.checkpointId !== input.checkpointId),
          )
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await tx.assessmentHumanRequest.updateMany({
          where: {
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
          data: { checkpointId: input.checkpointId },
        });
      }
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          executionState: input.toState,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
        },
      });
      await tx.assessmentRuntimeTurn.update({
        where: { id: run.executionId },
        data: {
          state:
            input.toState === AGENT_EXECUTION_STATES.PAUSED
              ? Controls.stopped
              : Controls.completed,
          ...(input.checkpointId
            ? { checkpointJson: { checkpointId: input.checkpointId } }
            : {}),
        },
      });
      if (input.toState === AGENT_EXECUTION_STATES.PAUSED) {
        await this.coordinator.transitionFromRuntimeAcknowledgementInTx(
          {
            assessmentId: input.assessmentId,
            targetRunId: run.executionId,
            acknowledgedState: Controls.stopped,
            requestId: pauseRequestId,
            correlationId: input.correlationId,
          },
          tx,
        );
      }
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
        executionId: run.executionId,
        payload: {
          fromState: AGENT_EXECUTION_STATES.RUNNING,
          toState: input.toState,
        },
        auditActor: ROOT_ACTOR,
      });
      return { executionState: input.toState };
    });
  }
}

interface LockedRuntimeRow {
  lifecycleState: AssessmentLifecycleState | null;
  lifecycleRevision: number | null;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
  threadId: string;
  checkpointNamespace: string;
  checkpointId: string | null;
  currentExecutionId: string | null;
  executionState: AgentExecutionState;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

interface FailedNativeCheckpoint {
  checkpointId: string;
  checkpointTimestamp: string;
}

export type SeparateCheckpointClient = {
  connect(): Promise<unknown>;
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  end(): Promise<unknown>;
};

/**
 * Business purpose: Construct a PostgreSQL client connected to a physically separate native checkpoint database.
 *
 * Business rules:
 * - Creates a standard pg.Client configured with 5-second query and connection timeouts.
 * - Used as the default client factory for separate checkpoint queries when no test override is installed.
 *
 * Execution flow:
 * 1. Instantiate and return a new pg.Client instance for the provided database connection URL.
 *
 * Failure cases:
 * - None during construction; connection failures are handled during client.connect.
 *
 * Side effects:
 * - Allocates a pg.Client object without opening network sockets until connect is called.
 */
function defaultSeparateCheckpointClientFactory(
  databaseUrl: string,
): SeparateCheckpointClient {
  return new Client({
    connectionString: databaseUrl,
    query_timeout: 5000,
    connectionTimeoutMillis: 5000,
  });
}

let separateCheckpointClientFactory: (
  databaseUrl: string,
) => SeparateCheckpointClient = defaultSeparateCheckpointClientFactory;

/**
 * Business purpose: Configure an alternative PostgreSQL client factory for separate checkpoint testing.
 *
 * Business rules:
 * - Overrides the module-level client factory for separate checkpoint queries during test execution.
 * - Restores standard pg.Client behavior when passed the default factory implementation.
 *
 * Execution flow:
 * 1. Assign the provided factory function to the module-scoped variable.
 *
 * Failure cases:
 * - None; assignment is synchronous and infallible.
 *
 * Side effects:
 * - Modifies the client factory reference used by querySeparateCheckpointDatabase.
 */
export function setSeparateCheckpointClientFactoryForTesting(
  factory: (databaseUrl: string) => SeparateCheckpointClient,
): void {
  separateCheckpointClientFactory = factory;
}

/**
 * Business purpose: Query the newest native checkpoint row from a physically separate native checkpoint database.
 *
 * Business rules:
 * - Connects read-only to the specified native checkpoint database URL with bounded query and connection timeouts.
 * - Verifies the existence of the public.checkpoints table before querying.
 * - Fetches only the newest checkpoint for the specified thread and native Root namespace.
 * - Always disconnects the client to prevent connection leaks regardless of success or failure.
 *
 * Execution flow:
 * 1. Instantiate and connect a dedicated PostgreSQL client to the checkpoint database URL.
 * 2. Verify that public.checkpoints exists via to_regclass.
 * 3. Query the newest checkpoint row for the thread and namespace, ordered by checkpoint_id descending.
 * 4. Clean up the connection and return the raw row if found.
 *
 * Failure cases:
 * - Connection failures, timeouts, missing table, or missing rows safely return undefined.
 *
 * Side effects:
 * - Establishes a short-lived read-only database connection to the separate checkpoint store.
 */
async function querySeparateCheckpointDatabase(
  databaseUrl: string,
  threadId: string,
): Promise<
  | {
      checkpointId: string;
      serializedCheckpointId: string | null;
      checkpointTimestamp: string | null;
      metadata: unknown;
    }
  | undefined
> {
  const client = separateCheckpointClientFactory(databaseUrl);
  try {
    await client.connect();
    const tableRes = await client.query<{ tableName: string | null }>(
      `SELECT to_regclass('public.checkpoints')::text AS "tableName"`,
    );
    if (!tableRes.rows[0]?.tableName) {
      return undefined;
    }
    const res = await client.query<{
      checkpointId: string;
      serializedCheckpointId: string | null;
      checkpointTimestamp: string | null;
      metadata: unknown;
    }>(
      `SELECT "checkpoint_id" AS "checkpointId",
          "checkpoint"->>'id' AS "serializedCheckpointId",
          "checkpoint"->>'ts' AS "checkpointTimestamp",
          "metadata"
        FROM "public"."checkpoints"
        WHERE "thread_id" = $1
          AND "checkpoint_ns" = $2
        ORDER BY "checkpoint_id" DESC
        LIMIT 1`,
      [threadId, NATIVE_ROOT_CHECKPOINT_NAMESPACE],
    );
    return res.rows[0];
  } catch {
    return undefined;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Business purpose: Recover a native checkpoint omitted from the API runtime row after a failed Root turn.
 *
 * Business rules:
 * - The newest checkpoint for the exact Root thread and native Root namespace must carry the same persisted
 *   assessment, transport run, Root boundary, and agent identity as the failed server-owned turn.
 * - When case pins are present, the checkpoint metadata must agree with the rule set, repository snapshot, and commit pins.
 * - The checkpoint row ID must match its serialized checkpoint ID, and its timestamp must fall within that turn.
 * - If the checkpoint table is absent from the API database, the authority checks the configured native checkpoint database URL.
 * - An unavailable table, missing row, malformed checkpoint, or mismatched provenance grants no resume authority.
 *
 * Execution flow:
 * 1. Check for the co-located native checkpoint table in the current database transaction.
 * 2. If absent and a separate native checkpoint database URL is configured, query that external database securely.
 * 3. Read only the newest checkpoint for this thread and the native Root namespace.
 * 4. Validate checkpoint identity, metadata, case pins, and timestamp against the failed turn before returning its ID.
 *
 * Failure cases:
 * - Missing table or row and any invalid identity or pin metadata return `null`; query errors abort or return `null`.
 *
 * Side effects:
 * - Performs read-only queries against the co-located or separate native checkpoint store.
 */
async function findFailedNativeCheckpoint(
  tx: Prisma.TransactionClient,
  input: {
    assessmentId: string;
    threadId: string;
    runtimeRunId: string;
    turnCreatedAt: Date;
    turnUpdatedAt: Date;
    casePins?: {
      ruleSetVersionId?: string | null;
      repositorySnapshotId?: string | null;
      repositoryCommit?: string | null;
    };
  },
): Promise<FailedNativeCheckpoint | null> {
  const [table] = await tx.$queryRaw<Array<{ tableName: string | null }>>(
    Prisma.sql`SELECT to_regclass('public.checkpoints')::text AS "tableName"`,
  );

  let checkpoint:
    | {
        checkpointId: string;
        serializedCheckpointId: string | null;
        checkpointTimestamp: string | null;
        metadata: unknown;
      }
    | undefined;

  if (table?.tableName) {
    const [row] = await tx.$queryRaw<
      Array<{
        checkpointId: string;
        serializedCheckpointId: string | null;
        checkpointTimestamp: string | null;
        metadata: unknown;
      }>
    >(
      Prisma.sql`SELECT "checkpoint_id" AS "checkpointId",
          "checkpoint"->>'id' AS "serializedCheckpointId",
          "checkpoint"->>'ts' AS "checkpointTimestamp",
          "metadata"
        FROM "public"."checkpoints"
        WHERE "thread_id" = ${input.threadId}
          AND "checkpoint_ns" = ${NATIVE_ROOT_CHECKPOINT_NAMESPACE}
        -- Checkpoint IDs are time-ordered; validate the newest row rather than falling back to older metadata.
        ORDER BY "checkpoint_id" DESC
        LIMIT 1`,
    );
    checkpoint = row;
  } else if (process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL) {
    checkpoint = await querySeparateCheckpointDatabase(
      process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL,
      input.threadId,
    );
  } else {
    return null;
  }

  if (
    !checkpoint?.checkpointId ||
    checkpoint.serializedCheckpointId !== checkpoint.checkpointId ||
    !checkpoint.checkpointTimestamp
  ) {
    return null;
  }

  const metadata =
    checkpoint.metadata &&
    typeof checkpoint.metadata === "object" &&
    !Array.isArray(checkpoint.metadata)
      ? (checkpoint.metadata as Record<string, unknown>)
      : null;
  if (
    !metadata ||
    metadata.assessment_id !== input.assessmentId ||
    metadata.lcsp_runtime_run_id !== input.runtimeRunId ||
    metadata.lcsp_boundary_name !== NATIVE_ROOT_BOUNDARY_NAME ||
    metadata.lc_agent_name !== NATIVE_ROOT_AGENT_NAME ||
    (input.casePins?.ruleSetVersionId &&
      typeof metadata.rule_set_version_id === "string" &&
      metadata.rule_set_version_id !== input.casePins.ruleSetVersionId) ||
    (input.casePins?.repositorySnapshotId &&
      typeof metadata.repository_snapshot_id === "string" &&
      metadata.repository_snapshot_id !==
        input.casePins.repositorySnapshotId) ||
    (input.casePins?.repositoryCommit &&
      typeof metadata.repository_commit === "string" &&
      metadata.repository_commit !== input.casePins.repositoryCommit)
  ) {
    return null;
  }

  const timestamp = new Date(checkpoint.checkpointTimestamp);
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp < input.turnCreatedAt ||
    timestamp > input.turnUpdatedAt
  ) {
    return null;
  }

  return {
    checkpointId: checkpoint.checkpointId,
    checkpointTimestamp: checkpoint.checkpointTimestamp,
  };
}

/** Same lock order as the lifecycle coordinator: assessment row, then runtime row. */
async function lockAssessmentAndRuntime(
  tx: Prisma.TransactionClient,
  assessmentId: string,
): Promise<LockedRuntimeRow | undefined> {
  const assessment = await tx.$queryRaw<
    Array<
      Pick<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "lifecycleState", "lifecycleRevision", "blockerReason", "blockerReference" FROM "Assessment"
      WHERE "id" = ${assessmentId} FOR UPDATE`,
  );
  if (!assessment[0]) return undefined;
  const runtime = await tx.$queryRaw<
    Array<
      Omit<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "threadId", "checkpointNamespace", "checkpointId", "currentExecutionId", "executionState",
        "leaseToken", "leaseExpiresAt"
      FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
  );
  if (!runtime[0]) return undefined;
  return { ...assessment[0], ...runtime[0] };
}

function humanFactBlockerRequestId(row: {
  blockerReason: unknown;
  blockerReference: unknown;
}): string | null {
  const blocker = assessmentBlockerSchema.safeParse({
    reason: row.blockerReason,
    reference: row.blockerReference,
  });
  return blocker.success &&
    blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE
    ? blocker.data.reference.humanResolutionRequestId
    : null;
}
