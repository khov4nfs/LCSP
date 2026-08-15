import { randomUUID } from "node:crypto";

import {
  REPOSITORY_SNAPSHOT_STATUSES,
  type RepositorySnapshotStatus,
} from "@lcsp/contracts/github-integration";

export type RepositorySnapshotProviderMetadata = {
  authorDate: string | null;
  committerDate: string | null;
  htmlUrl: string;
  requestedRevision: string;
};

type RepositorySnapshotProps = {
  id: string;
  assessmentId: string;
  organizationId: string;
  connectionId: string;
  repositoryId: string;
  repositoryFullName: string;
  branch: string | null;
  ref: string | null;
  commitSha: string;
  providerMetadata: RepositorySnapshotProviderMetadata;
  actorId: string;
  status: RepositorySnapshotStatus;
  createdAt: Date;
};

type NewRepositorySnapshotProps = Omit<RepositorySnapshotProps, "id">;

/**
 * Represents an immutable assessment-bound repository revision resolved from an active GitHub connection.
 */
export class RepositorySnapshot {
  private props: RepositorySnapshotProps;

  /**
   * Creates a snapshot aggregate with a generated identifier from prepared immutable revision metadata.
   *
   * @param props - Snapshot properties excluding the generated identifier.
   */
  private constructor(props: NewRepositorySnapshotProps) {
    this.props = { ...props, id: randomUUID() };
  }

  /**
   * Creates a ready repository snapshot for an exact resolved commit.
   *
   * @param input - Assessment/tenant/connection/repository identity, requested revision metadata, commit SHA, and actor.
   * @returns Newly created repository snapshot in the ready lifecycle state.
   */
  static create(
    input: Omit<RepositorySnapshotProps, "id" | "status" | "createdAt">,
  ): RepositorySnapshot {
    return new RepositorySnapshot({
      ...input,
      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
      createdAt: new Date(),
    });
  }

  /**
   * Reconstructs a repository snapshot from persisted state without changing its immutable identity or revision.
   *
   * @param props - Fully populated persisted snapshot properties.
   * @returns Rehydrated repository snapshot aggregate.
   */
  static rehydrate(props: RepositorySnapshotProps): RepositorySnapshot {
    const entity = new RepositorySnapshot(props);
    entity.props = props;
    return entity;
  }

  /** @returns The repository snapshot identifier. */
  get id(): string {
    return this.props.id;
  }

  /** @returns The assessment that owns the snapshot. */
  get assessmentId(): string {
    return this.props.assessmentId;
  }

  /** @returns The organization that owns the snapshot. */
  get organizationId(): string {
    return this.props.organizationId;
  }

  /** @returns The repository connection used to resolve the snapshot. */
  get connectionId(): string {
    return this.props.connectionId;
  }

  /** @returns The GitHub repository identifier. */
  get repositoryId(): string {
    return this.props.repositoryId;
  }

  /** @returns The owner-qualified repository name. */
  get repositoryFullName(): string {
    return this.props.repositoryFullName;
  }

  /** @returns The requested branch when the snapshot originated from a branch reference. */
  get branch(): string | null {
    return this.props.branch;
  }

  /** @returns The requested Git ref when one was supplied. */
  get ref(): string | null {
    return this.props.ref;
  }

  /** @returns The exact immutable commit SHA pinned by the snapshot. */
  get commitSha(): string {
    return this.props.commitSha;
  }

  /** @returns A defensive copy of provider metadata describing the resolved GitHub commit. */
  get providerMetadata(): RepositorySnapshotProviderMetadata {
    return { ...this.props.providerMetadata };
  }

  /** @returns The user that pinned the snapshot. */
  get actorId(): string {
    return this.props.actorId;
  }

  /** @returns The current repository snapshot lifecycle status. */
  get status(): RepositorySnapshotStatus {
    return this.props.status;
  }

  /** @returns The snapshot creation timestamp. */
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
