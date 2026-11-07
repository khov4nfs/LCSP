import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { randomUUID } from "node:crypto";
import { AssessmentRepositorySetupLoader } from "./assessment-repository-setup.loader.js";

describe("AssessmentRepositorySetupLoader source scope", () => {
  it.each([null, "apps/Chat bôt"])(
    "projects the pinned snapshot scope without widening: %s",
    async (sourcePathPrefix) => {
      const assessmentId = randomUUID();
      const snapshotId = randomUUID();
      const connectionId = randomUUID();
      const ownerId = randomUUID();
      const snapshotRead = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          id: snapshotId,
          assessmentId,
          connectionId,
          repositoryFullName: "owner/project",
          branch: "main",
          commitSha: "a".repeat(40),
          sourcePathPrefix,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
          createdAt: new Date("2026-11-04T00:00:00.000Z"),
        });
      const tx = {
        assessment: {
          findUnique: () =>
            Promise.resolve({
              id: assessmentId,
              ownerId,
              lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
              lifecycleRevision: 1,
              blockerReason: null,
              blockerReference: null,
              runtime: {
                threadId: randomUUID(),
                rootAgentVersion: "test-source-scope",
                checkpointNamespace: assessmentId,
                checkpointId: null,
                currentExecutionId: randomUUID(),
                executionState: AGENT_EXECUTION_STATES.RUNNING,
                eventSequence: 0,
                startedAt: new Date("2026-11-04T00:00:00.000Z"),
                lastResumedAt: null,
                updatedAt: new Date("2026-11-04T00:00:00.000Z"),
              },
              domainCase: { repositorySnapshotId: snapshotId },
            }),
        },
        repositorySnapshot: { findFirst: snapshotRead },
        repositoryConnection: {
          findFirst: () =>
            Promise.resolve({
              id: connectionId,
              provider: CREDENTIAL_PROVIDERS.github,
              repositoryId: "123",
              repositoryFullName: "owner/project",
              defaultBranch: "main",
              status: REPOSITORY_CONNECTION_STATUSES.active,
            }),
        },
        repositoryScanJob: { findFirst: () => Promise.resolve(null) },
      };
      const loader = new AssessmentRepositorySetupLoader({
        $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
          run(tx),
      } as never);

      const result = await loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "scope-projection",
      });

      expect(snapshotRead).toHaveBeenCalledWith({
        where: {
          id: snapshotId,
          assessmentId,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        },
      });
      expect(result.snapshot).toMatchObject({
        id: snapshotId,
        assessmentId,
        sourcePathPrefix,
      });
    },
  );
});
