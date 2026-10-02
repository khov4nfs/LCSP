import { Command } from "@nestjs/cqrs";
import type { AssessmentRepositoryRelationType } from "@lcsp/contracts/assessment";

export const REPOSITORY_RELATION_MUTATIONS = {
  create: "CREATE",
  update: "UPDATE",
  remove: "REMOVE",
} as const;

export type RepositoryRelationMutation =
  (typeof REPOSITORY_RELATION_MUTATIONS)[keyof typeof REPOSITORY_RELATION_MUTATIONS];

export class ManageRepositoryRelationCommand extends Command<{
  id: string | null;
}> {
  constructor(
    public readonly mutation: RepositoryRelationMutation,
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly relationId: string | null,
    public readonly fromSnapshotId: string | null,
    public readonly toSnapshotId: string | null,
    public readonly type: AssessmentRepositoryRelationType | null,
    public readonly correlationId: string,
  ) {
    super();
  }
}
