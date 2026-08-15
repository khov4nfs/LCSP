import { randomBytes, randomUUID } from "node:crypto";

type GitHubAppInstallStateProps = {
  id: string;
  state: string;
  assessmentId: string | null;
  organizationId: string;
  userId: string;
  redirectUri: string;
  expiresAt: Date;
  createdAt: Date;
};

type NewGitHubAppInstallStateProps = Omit<GitHubAppInstallStateProps, "id">;

/**
 * Represents a short-lived opaque state binding a GitHub App installation redirect to its originating user, organization, session flow, and optional assessment.
 */
export class GitHubAppInstallState {
  private props: GitHubAppInstallStateProps;

  /**
   * Creates a new install-state aggregate with a generated identifier from validated properties.
   *
   * @param props - Install-state properties excluding the generated entity identifier.
   */
  private constructor(props: NewGitHubAppInstallStateProps) {
    this.props = { ...props, id: randomUUID() };
  }

  /**
   * Creates a cryptographically random installation state with an absolute expiration time.
   *
   * @param input - Organization/user binding, redirect target, optional assessment, and TTL in milliseconds.
   * @returns Newly generated GitHub App installation state.
   */
  static create(input: {
    organizationId: string;
    userId: string;
    redirectUri: string;
    assessmentId?: string | null;
    ttlMs: number;
  }): GitHubAppInstallState {
    const now = new Date();

    return new GitHubAppInstallState({
      state: randomBytes(32).toString("hex"),
      assessmentId: input.assessmentId ?? null,
      organizationId: input.organizationId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      expiresAt: new Date(now.getTime() + input.ttlMs),
      createdAt: now,
    });
  }

  /**
   * Reconstructs an install-state aggregate from persisted properties without regenerating identity or state.
   *
   * @param props - Fully populated persisted install-state properties.
   * @returns Rehydrated install-state aggregate.
   */
  static rehydrate(props: GitHubAppInstallStateProps): GitHubAppInstallState {
    const entity = new GitHubAppInstallState(props);
    entity.props = props;
    return entity;
  }

  /** @returns The install-state entity identifier. */
  get id(): string {
    return this.props.id;
  }

  /** @returns The opaque state value sent through the GitHub installation redirect. */
  get state(): string {
    return this.props.state;
  }

  /** @returns The optional assessment bound to the installation flow. */
  get assessmentId(): string | null {
    return this.props.assessmentId;
  }

  /** @returns The organization that initiated the installation. */
  get organizationId(): string {
    return this.props.organizationId;
  }

  /** @returns The user that initiated the installation. */
  get userId(): string {
    return this.props.userId;
  }

  /** @returns The client redirect URI restored after callback processing. */
  get redirectUri(): string {
    return this.props.redirectUri;
  }

  /** @returns The timestamp after which the state must no longer be accepted. */
  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  /** @returns The install-state creation timestamp. */
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
