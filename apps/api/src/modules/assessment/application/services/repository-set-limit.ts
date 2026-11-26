import { resolveRepositoryLimit } from "@lcsp/contracts/assessment-domain";

/** Environment variable that lowers (never raises) the number of repositories one assessment may pin. */
export const REPOSITORY_LIMIT_ENV = "LCSP_MAX_ASSESSMENT_REPOSITORIES";

/**
 * Business purpose: Give every API boundary the same answer to "how many repositories may this assessment pin",
 * so operators can keep the product at one repository until every runtime stage handles a repository set.
 * Business rules:
 * - The contract maximum is the ceiling; the environment setting can only lower it.
 * - The value is read in this single place so setup, pinning and the setup view cannot disagree.
 * Execution flow:
 * 1. Read the configured value.
 * 2. Clamp it through the shared contract resolver.
 * Failure cases:
 * - A missing or malformed setting falls back to the contract maximum.
 * Side effects:
 * - Reads process environment only.
 */
export function currentRepositoryLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return resolveRepositoryLimit(env[REPOSITORY_LIMIT_ENV]);
}
