import {
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

/**
 * Represents one assessment repository connection created through a per-user provider credential (legacy GitHub App rows are rehydrate-only).
 */
export class RepositoryConnection {
  private props: RepositoryConnectionProps;

  /**
   * Wraps already validated persisted properties.
   *
   * @param props - Repository connection properties.
   */
  private constructor(props: RepositoryConnectionProps) {
    this.props = props;
  }

  /**
   * Reconstructs a repository connection from persisted properties without changing its identity or lifecycle state.
   *
   * @param props - Fully populated persisted repository connection properties.
   * @returns Rehydrated repository connection aggregate.
   */
  static rehydrate(props: RepositoryConnectionProps): RepositoryConnection {
    return new RepositoryConnection(props);
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
