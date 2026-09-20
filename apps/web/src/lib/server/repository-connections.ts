import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_AUTHENTICATION_MODES,
  type CredentialProvider,
  type RepositoryAuthenticationMode,
} from "@lcsp/contracts/github-integration";

export function sanitizeRepositoriesPayload(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const repositories = (data as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) {
    return null;
  }

  return repositories.every((repository) => {
    if (typeof repository !== "object" || repository === null) {
      return false;
    }

    const candidate = repository as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      Object.values(CREDENTIAL_PROVIDERS).includes(
        candidate.provider as CredentialProvider,
      ) &&
      Object.values(REPOSITORY_AUTHENTICATION_MODES).includes(
        candidate.authentication_mode as RepositoryAuthenticationMode,
      ) &&
      (typeof candidate.installation_id === "string" ||
        candidate.installation_id === null) &&
      typeof candidate.repository_name === "string" &&
      typeof candidate.repository_full_name === "string" &&
      typeof candidate.default_branch === "string" &&
      typeof candidate.status === "string" &&
      typeof candidate.connected_at === "string" &&
      (typeof candidate.revoked_at === "string" ||
        candidate.revoked_at === null) &&
      (typeof candidate.assessment_id === "string" ||
        candidate.assessment_id === null) &&
      (typeof candidate.assessment_name === "string" ||
        candidate.assessment_name === null)
    );
  })
    ? { repositories }
    : null;
}
