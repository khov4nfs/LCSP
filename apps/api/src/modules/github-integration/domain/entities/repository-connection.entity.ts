import { randomUUID } from "node:crypto";
import {
  REPOSITORY_CONNECTION_STATUSES,
  type RepositoryConnectionStatus,
} from "@lcsp/contracts/github-integration";

type RepositoryConnectionProps = {
  id: string;
  assessmentId: string | null;
  userId: string;
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  defaultBranch: string;
  permissions: Record<string, string>;
  status: RepositoryConnectionStatus;
  connectedAt: Date;
  revokedAt: Date | null;
};

type NewRepositoryConnectionProps = Omit<RepositoryConnectionProps, "id">;

/**
 * Represents one organization-owned GitHub repository connection created through an App installation.
 */
export class RepositoryConnection {
  private props: RepositoryConnectionProps;

  /**
   * Creates a connection aggregate with a generated identifier from already validated properties.
   *
   * @param props - Repository connection properties excluding the generated identifier.
   */
  private constructor(props: NewRepositoryConnectionProps) {
    this.props = { ...props, id: randomUUID() };
  }

  /**
   * Creates an active repository connection from GitHub installation and repository metadata.
   *
   * @param input - Assessment/tenant/user binding, GitHub installation/repository identity, branch, and granted permissions.
   * @returns Newly connected repository aggregate in the active lifecycle state.
   */
  static create(input: {
    assessmentId: string | null;
    userId: string;
    installationId: string;
    repositoryId: string;
    repositoryName: string;
    repositoryFullName: string;
    defaultBranch: string;
    permissions: Record<string, string>;
  }): RepositoryConnection {
    return new RepositoryConnection({
      assessmentId: input.assessmentId,
      userId: input.userId,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryName,
      repositoryFullName: input.repositoryFullName,
      defaultBranch: input.defaultBranch,
      permissions: input.permissions,
      status: REPOSITORY_CONNECTION_STATUSES.active,
      connectedAt: new Date(),
      revokedAt: null,
    });
  }

  /**
   * Reconstructs a repository connection from persisted properties without changing its identity or lifecycle state.
   *
   * @param props - Fully populated persisted repository connection properties.
   * @returns Rehydrated repository connection aggregate.
   */
  static rehydrate(props: RepositoryConnectionProps): RepositoryConnection {
    const entity = new RepositoryConnection(props);
    entity.props = props;
    return entity;
  }

  /** @returns The repository connection identifier. */
  get id(): string {
    return this.props.id;
  }

  /** @returns The optional assessment directly linked to this repository connection. */
  get assessmentId(): string | null {
    return this.props.assessmentId;
  }

  /** @returns The organization that owns the connection. */

  /** @returns The user that established the connection. */
  get userId(): string {
    return this.props.userId;
  }

  /** @returns The GitHub App installation identifier used for authenticated API access. */
  get installationId(): string {
    return this.props.installationId;
  }

  /** @returns The GitHub repository identifier. */
  get repositoryId(): string {
    return this.props.repositoryId;
  }

  /** @returns The short repository name. */
  get repositoryName(): string {
    return this.props.repositoryName;
  }

  /** @returns The owner-qualified GitHub repository name. */
  get repositoryFullName(): string {
    return this.props.repositoryFullName;
  }

  /** @returns The repository default branch captured at connection time. */
  get defaultBranch(): string {
    return this.props.defaultBranch;
  }

  /** @returns The GitHub App permissions associated with the connection. */
  get permissions(): Record<string, string> {
    return this.props.permissions;
  }

  /** @returns The current repository connection lifecycle status. */
  get status(): RepositoryConnectionStatus {
    return this.props.status;
  }

  /** @returns The timestamp when the repository was connected. */
  get connectedAt(): Date {
    return this.props.connectedAt;
  }

  /** @returns The revocation timestamp, or null while the connection remains active. */
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
}
