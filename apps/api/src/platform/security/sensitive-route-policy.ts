type SensitiveRouteDefinition = {
  routeId: string;
  method: string;
  pathTemplate: string;
};

export const SENSITIVE_ROUTE_IDS = {
  githubCliRepositoryDiscovery: "GITHUB_CLI_REPOSITORY_DISCOVERY",
  githubCliRepositoryConnect: "GITHUB_CLI_REPOSITORY_CONNECT",
  providerCredentialDisconnect: "PROVIDER_CREDENTIAL_DISCONNECT",
  mfaRecoveryCodesGenerate: "MFA_RECOVERY_CODES_GENERATE",
  mfaDisable: "MFA_DISABLE",
} as const;

const sensitiveRouteRegistry = new Map<string, SensitiveRouteDefinition>();

export const SENSITIVE_ACTION_REAUTH_TTL_MS = 5 * 60_000;

export type SensitiveRouteMatch = {
  routeId: string;
};

type SensitiveActionVerifiedAt = Date | number | null | undefined;

/**
 * Business purpose: Reset the sensitive route registry to an empty state for test isolation.
 * Business rules:
 * - Intended for testing environments to prevent cross-test registry pollution.
 * Execution flow:
 * 1. Clear all entries from the sensitiveRouteRegistry map.
 * Failure cases:
 * - None.
 * Side effects:
 * - Clears in-memory sensitiveRouteRegistry Map.
 */
export function resetSensitiveRouteRegistry(): void {
  sensitiveRouteRegistry.clear();
}

/**
 * Business purpose: Register a sensitive route pattern requiring step-up re-authentication in the in-memory registry.
 * Business rules:
 * - Route ID, HTTP method, and path template must all be non-empty strings.
 * - HTTP method must be normalized to uppercase.
 * - Path template must be normalized to strip trailing slashes for canonical registration.
 * Execution flow:
 * 1. Normalize and validate input fields (routeId, method, pathTemplate).
 * 2. Return early if any mandatory field is empty after trimming.
 * 3. Construct unique composite registry key: routeId:method:pathTemplate.
 * 4. Store normalized definition in the sensitive route registry map.
 * Failure cases:
 * - Silently drops registration if routeId, method, or pathTemplate is empty or invalid.
 * Side effects:
 * - Mutates the in-memory sensitiveRouteRegistry Map.
 */
export function registerSensitiveRoute(
  definition: SensitiveRouteDefinition,
): void {
  const normalizedMethod = definition.method.trim().toUpperCase();
  const normalizedPathTemplate = normalizeRoutePath(definition.pathTemplate);
  if (
    definition.routeId.trim().length === 0 ||
    normalizedMethod.length === 0 ||
    normalizedPathTemplate.length === 0
  ) {
    return;
  }

  const registryKey = [
    definition.routeId,
    normalizedMethod,
    normalizedPathTemplate,
  ].join(":");
  sensitiveRouteRegistry.set(registryKey, {
    routeId: definition.routeId,
    method: normalizedMethod,
    pathTemplate: normalizedPathTemplate,
  });
}

/**
 * Business purpose: Evaluate an incoming HTTP request against registered sensitive routes to enforce step-up authentication.
 * Business rules:
 * - Request method is matched case-insensitively against registered policies.
 * - Request path matching is trailing-slash agnostic (e.g. /path and /path/ match identically).
 * - Only routes explicitly registered in sensitiveRouteRegistry are deemed sensitive.
 * Execution flow:
 * 1. Normalize incoming HTTP method to uppercase and incoming path via normalizeRoutePath.
 * 2. Search sensitive route registry for a matching candidate policy.
 * 3. If a matching policy is found, return the sensitive route match containing routeId.
 * 4. If no policy matches, return null indicating the route is not sensitive.
 * Failure cases:
 * - Returns null if method or path is empty or does not match any registered sensitive route.
 * Side effects:
 * - Read-only registry lookup with no persistence or state mutations.
 */
export function matchSensitiveRoute(
  method: string,
  route: string,
): SensitiveRouteMatch | null {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = normalizeRoutePath(route);

  const policy = Array.from(sensitiveRouteRegistry.values()).find(
    (candidate) =>
      candidate.method === normalizedMethod &&
      pathTemplateMatches(candidate.pathTemplate, normalizedPath),
  );

  return policy ? { routeId: policy.routeId } : null;
}

/**
 * Business purpose: Determine the expiration timestamp of a sensitive action verification.
 * Business rules:
 * - Verification TTL is fixed at SENSITIVE_ACTION_REAUTH_TTL_MS (5 minutes).
 * - If verifiedAt is missing, null, or undefined, verification has no valid expiration.
 * Execution flow:
 * 1. Normalize verifiedAt timestamp to epoch milliseconds.
 * 2. If valid timestamp exists, add SENSITIVE_ACTION_REAUTH_TTL_MS and return Date.
 * 3. If timestamp is missing or unsupported, return null.
 * Failure cases:
 * - Returns null when verifiedAt cannot be resolved to a valid timestamp.
 * Side effects:
 * - Read-only timestamp calculation with no state mutations.
 */
export function sensitiveActionVerificationExpiresAt(
  verifiedAt: SensitiveActionVerifiedAt,
): Date | null {
  const verifiedAtMs = sensitiveActionVerifiedAtMs(verifiedAt);
  return verifiedAtMs
    ? new Date(verifiedAtMs + SENSITIVE_ACTION_REAUTH_TTL_MS)
    : null;
}

/**
 * Business purpose: Validate whether a user's sensitive-action step-up re-authentication remains active and unexpired.
 * Business rules:
 * - Verification is valid only if an expiration date exists and is strictly greater than the current timestamp.
 * - Expired or absent verifications require the user to perform fresh re-authentication.
 * Execution flow:
 * 1. Calculate expiration timestamp using sensitiveActionVerificationExpiresAt.
 * 2. Compare expiration time in milliseconds against current time now.
 * 3. Return true if expiration is strictly greater than now, otherwise false.
 * Failure cases:
 * - Returns false if verification timestamp is absent, expired, or invalid.
 * Side effects:
 * - Read-only temporal evaluation with no state mutations.
 */
export function isSensitiveActionVerificationFresh(
  verifiedAt: SensitiveActionVerifiedAt,
  now: number,
): boolean {
  const expiresAt = sensitiveActionVerificationExpiresAt(verifiedAt);
  return expiresAt !== null && expiresAt.getTime() > now;
}

/**
 * Normalizes a supported sensitive-action verification timestamp to epoch milliseconds.
 *
 * @param verifiedAt - Date, epoch milliseconds, or empty verification value.
 * @returns Epoch milliseconds, or null when the value is absent or unsupported.
 */
function sensitiveActionVerifiedAtMs(
  verifiedAt: SensitiveActionVerifiedAt,
): number | null {
  if (verifiedAt instanceof Date) {
    return verifiedAt.getTime();
  }

  return typeof verifiedAt === "number" ? verifiedAt : null;
}

/**
 * Normalizes a route or URL to its pathname for policy matching, stripping redundant trailing slashes.
 *
 * Rationale (Why): Prevents authentication/authorization bypasses where an attacker or client
 * appends a trailing slash (e.g. `/api/auth/mfa/disable/`) to bypass sensitive route re-authentication policies.
 * Mechanism (How): Extracts the URL pathname and strips any trailing slashes unless the path is root `/`.
 * Invariants (What): Non-empty path strings always return a canonical pathname without trailing slash (e.g. `/path`).
 *
 * @param route - Relative path or URL to normalize.
 * @returns Normalized pathname, or an empty string for invalid/empty input.
 */
function normalizeRoutePath(route: string): string {
  const trimmedRoute = route.trim();
  if (trimmedRoute.length === 0) {
    return "";
  }

  try {
    const rawPathname = new URL(trimmedRoute, "http://lcsp.local").pathname;
    // Rationale (Why): In Express/NestJS, `/api/auth/mfa/disable` and `/api/auth/mfa/disable/` route to the same handler.
    // Mechanism (How): Strip any trailing slashes unless the path is root `/`.
    // Invariants (What): Guarantees canonical path matching and prevents trailing-slash auth bypass.
    if (rawPathname.length > 1 && rawPathname.endsWith("/")) {
      return rawPathname.replace(/\/+$/, "");
    }
    return rawPathname;
  } catch {
    return "";
  }
}

/**
 * Tests a normalized request path against a route template.
 *
 * @param template - Registered path template supporting `:parameter` and `*` wildcard segments.
 * @param path - Normalized request pathname.
 * @returns True when the path matches the template.
 */
function pathTemplateMatches(template: string, path: string): boolean {
  return compilePathTemplate(template).test(path);
}

/**
 * Compiles a route template into an anchored regular expression supporting optional trailing slashes.
 *
 * Rationale (Why): Express and NestJS match routes regardless of whether a trailing slash is present.
 * The sensitive route policy must mirror this behavior so that trailing slash variations cannot bypass matching.
 * Mechanism (How): Replaces dynamic `:param` segments with `[^/]+` and wildcards `*` with `.*`,
 * and anchors the pattern with optional trailing slash `(?:/)?$`.
 * Invariants (What): Ensures deterministic matching for both `/route` and `/route/`.
 *
 * @param template - Path template whose dynamic and wildcard segments should be converted to regex fragments.
 * @returns Regular expression matching the complete request path.
 */
function compilePathTemplate(template: string): RegExp {
  const normalized = normalizeRoutePath(template);
  const pattern = normalized
    .split("/")
    .map((segment) => {
      if (segment === "*") {
        return ".*";
      }

      if (segment.startsWith(":")) {
        return "[^/]+";
      }

      return escapeRegExp(segment);
    })
    .join("/");

  // Rationale (Why): Support optional trailing slash `(?:/)?$` for defense-in-depth matching.
  // Mechanism (How): Append non-capturing optional slash group before end-of-string anchor `$`.
  // Invariants (What): Matches both `/api/auth/mfa/disable` and `/api/auth/mfa/disable/`.
  return new RegExp(`^${pattern}(?:/)?$`, "u");
}

/**
 * Escapes regular-expression metacharacters in a literal route segment.
 *
 * @param value - Literal route segment to escape.
 * @returns Regex-safe literal string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
