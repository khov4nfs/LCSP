import type {
  GitHubCredentialErrorCode,
  GitHubCredentialOperation,
} from "@lcsp/contracts/github-integration";

import type { CredentialLease } from "../../security/credential-lease.js";

export const CREDENTIAL_AUTHORIZATION_RESOLVER = Symbol(
  "CREDENTIAL_AUTHORIZATION_RESOLVER",
);

export type CredentialOperationContext = {
  actorId: string | null;
  userId: string;
  assessmentId: string | null;
  operation: GitHubCredentialOperation;
  correlationId: string;
};

export type RotationAuthority = {
  connectionId: string;
  userId: string;
  repositoryFullNames: readonly string[];
  expectedCredentialVersion: number;
};

export type CredentialRevocationPlan = RotationAuthority & {
  affectedConnectionIds: readonly string[];
};

/** Resolves credentials through an authorized connection, never an arbitrary credential ID. */
export interface CredentialAuthorizationResolverPort {
  resolveForConnection(
    context: CredentialOperationContext,
    connectionId: string,
    expectedRepositoryFullName: string,
  ): Promise<CredentialLease>;
  markInvalid(
    connectionId: string,
    credentialVersion: number,
    safeReason: GitHubCredentialErrorCode,
  ): Promise<void>;
  assertRotationAuthority(
    context: CredentialOperationContext,
    connectionId: string,
  ): Promise<RotationAuthority>;
  revokeForConnection(
    context: CredentialOperationContext,
    connectionId: string,
  ): Promise<CredentialRevocationPlan>;
}
