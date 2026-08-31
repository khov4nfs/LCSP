import { randomUUID } from "node:crypto";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_AUTHENTICATION_MODES,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type RepositoryAuthenticationMode,
  type RepositoryConnectionStatus,
} from "@lcsp/contracts/github-integration";
import type { CredentialAuthorizationStatus } from "@lcsp/contracts/github-integration";

type RepositoryConnectionProps = {
  id: string;
  assessmentId: string | null;
  userId: string;
  provider?: CredentialProvider;
  installationId: string | null;
  authenticationMode?: RepositoryAuthenticationMode;
  providerCredentialId?: string | null;
  credentialVersion?: number | null;
  credentialAuthorizedByUserId?: string | null;
  credentialAuthorizationStatus?: CredentialAuthorizationStatus | null;
  credentialValidatedAt?: Date | null;
  credentialRevokedAt?: Date | null;
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
 * Represents one assessment repository connection created through an App installation or provider credential.
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
   * @param input - Assessment/user binding, GitHub installation/repository identity, branch, and granted permissions.
   * @returns Newly connected repository aggregate in the active lifecycle state.
   */
  static create(input: {
    assessmentId: string | null;
    userId: string;
    provider?: CredentialProvider;
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
      provider: input.provider ?? CREDENTIAL_PROVIDERS.github,
      installationId: input.installationId,
      authenticationMode: REPOSITORY_AUTHENTICATION_MODES.githubApp,
      providerCredentialId: null,
      credentialVersion: null,
      credentialAuthorizedByUserId: null,
      credentialAuthorizationStatus: null,
      credentialValidatedAt: null,
      credentialRevokedAt: null,
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

  get provider(): CredentialProvider {
    return this.props.provider ?? CREDENTIAL_PROVIDERS.github;
  }

  /** @returns The GitHub App installation identifier used for authenticated API access. */
  get installationId(): string {
    if (!this.props.installationId) {
      throw new Error("github_app_installation_id_unavailable");
    }
    return this.props.installationId;
  }

  /** Nullable persistence value used when representing a CLI-authenticated connection. */
  get installationIdOrNull(): string | null {
    return this.props.installationId;
  }

  get authenticationMode(): RepositoryAuthenticationMode {
    return (
      this.props.authenticationMode ?? REPOSITORY_AUTHENTICATION_MODES.githubApp
    );
  }

  get providerCredentialId(): string | null {
    return this.props.providerCredentialId ?? null;
  }

  get credentialVersion(): number | null {
    return this.props.credentialVersion ?? null;
  }
  get credentialAuthorizedByUserId(): string | null {
    return this.props.credentialAuthorizedByUserId ?? null;
  }
  get credentialAuthorizationStatus(): CredentialAuthorizationStatus | null {
    return this.props.credentialAuthorizationStatus ?? null;
  }
  get credentialValidatedAt(): Date | null {
    return this.props.credentialValidatedAt ?? null;
  }
  get credentialRevokedAt(): Date | null {
    return this.props.credentialRevokedAt ?? null;
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
